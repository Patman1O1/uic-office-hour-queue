-- R4: retain the existing authorization, projections, and revision signals.
-- Student predictions require three positive recent call-to-done samples.
create or replace function officehours_private.queue_view(p_code text,p_role text,p_id uuid default null)
returns jsonb language plpgsql stable set search_path='' as $$
declare
  s officehours_private.sessions%rowtype;
  metadata jsonb;
  roster jsonb;
  parked jsonb;
  own jsonb;
  service_ms bigint;
  called_count integer;
  sample_count integer;
  remaining_ms bigint;
begin
  select * into strict s from officehours_private.sessions where code=p_code;
  select count(*) into called_count from officehours_private.entries where code=p_code and status='CALLED';
  select round(avg(duration))::bigint,count(*) into service_ms,sample_count from (
    select extract(epoch from (finished_at-called_at))*1000 duration
    from officehours_private.entries where code=p_code and status='DONE' and called_at is not null and finished_at > called_at
    order by finished_at desc limit 10
  ) samples;
  -- Multiple called students do not tell us how many are actually being
  -- helped concurrently. An overrun also has no reliable remaining duration.
  if called_count=1 and sample_count>=3 then
    select case when called_at<=statement_timestamp() then
      service_ms-floor(extract(epoch from (statement_timestamp()-called_at))*1000)::bigint end
    into remaining_ms from officehours_private.entries where code=p_code and status='CALLED';
  elsif called_count=0 then remaining_ms=0;
  end if;
  metadata=jsonb_build_object('code',s.code,'courseId',s.course_id,'name',s.name,'hostName',s.host_name,'hostRole',s.host_role,
    'open',s.ended_at is null,'createdAt',floor(extract(epoch from s.created_at)*1000),
    'endedAt',floor(extract(epoch from s.ended_at)*1000),'revision',s.revision,
    'waitingCount',(select count(*) from officehours_private.entries where code=p_code and status='WAITING'),'calledCount',called_count);
  if p_role='public' then return jsonb_build_object('session',metadata); end if;
  with waiting as (select id,row_number() over(order by order_key,id) pos from officehours_private.entries where code=p_code and status='WAITING'),
  items as (
    select e.*,w.pos,jsonb_build_object('id',e.id,'name',e.name,'netId',e.net_id,'topic',e.topic,'details',e.details,
      'status',e.status,'joinedAt',floor(extract(epoch from e.joined_at)*1000),
      'calledAt',floor(extract(epoch from e.called_at)*1000),'position',w.pos) item
    from officehours_private.entries e left join waiting w using(id) where e.code=p_code
  )
  select
    coalesce(jsonb_agg(item order by case when status='CALLED' then 0 else 1 end,order_key,id) filter(where status in ('WAITING','CALLED')),'[]'),
    coalesce(jsonb_agg(item order by order_key,id) filter(where status='MOVED_ASIDE'),'[]'),
    (select jsonb_build_object('id',id,'name',name,'topic',topic,'status',status,'position',pos,
      'ahead',greatest(0,coalesce(pos,1)-1),'estWaitMs',case
        when pos is null or s.ended_at is not null or called_count>1 then null
        when pos=1 and called_count=0 then 0
        when sample_count<3 or remaining_ms is null or (called_count=1 and remaining_ms<=0) then null
        else (pos-1)*service_ms+remaining_ms end,
      'joinedAt',floor(extract(epoch from joined_at)*1000),'calledAt',floor(extract(epoch from called_at)*1000)) from items where id=p_id)
  into roster,parked,own from items;
  if p_role='host' then
    return jsonb_build_object('view',jsonb_build_object('session',metadata,'queue',roster,'movedAside',parked,'avgServiceMs',coalesce(service_ms,300000),
      'helpedCount',(select count(*) from officehours_private.entries where code=p_code and status='DONE')));
  end if;
  return jsonb_build_object('view',jsonb_build_object('session',metadata,'me',own));
end $$;


-- Do not train on completions of uncalled or parked students.
create or replace function officehours_private.dispatch(p_event text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  s officehours_private.sessions%rowtype;
  e officehours_private.entries%rowtype;
  v_code text;
  secret text;
  hashed text;
  v_name text;
  v_netid text;
  v_topic text;
  v_details text;
  v_course text;
  v_role text;
  action text;
  next_order bigint;
  result jsonb;
  changed boolean=false;
  now_at timestamptz=clock_timestamp();
  alphabet constant text='ABCDEFGHJKMNPQRSTUVWXYZ23456789';
begin
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Invalid request.'; end if;
  if p_event not in ('host:create','host:watch','host:action','session:watch','student:join','student:watch','student:leave') then raise exception 'Unknown operation.'; end if;
  v_code=regexp_replace(upper(coalesce(p_payload->>'code','')),'[^A-Z0-9]','','g');
  if p_event='host:create' then
    secret=p_payload->>'idempotencyKey';
    if secret is null or secret !~ '^[A-Za-z0-9_-]{43}$' then raise exception 'A secure creation key is required.'; end if;
    hashed=encode(extensions.digest(secret,'sha256'),'hex');
    -- Serialize same-key creation retries even before a queue row exists.
    perform pg_advisory_xact_lock(hashtextextended(hashed,0));
    v_name=btrim(coalesce(p_payload->>'hostName',''));
    v_course=btrim(coalesce(p_payload->>'courseId',''));
    v_topic=btrim(coalesce(p_payload->>'name',''));
    v_role=coalesce(p_payload->>'role','TA');
    if length(v_name) not between 1 and 60 or length(v_course) not between 1 and 30 or length(v_topic) not between 1 and 60 or v_role not in ('TA','INSTRUCTOR') then raise exception 'Enter a valid host name, course and session name.'; end if;
    select * into s from officehours_private.sessions where host_key_hash=hashed;
    if found then
      if s.host_name<>v_name or s.course_id<>v_course or s.name<>v_topic or s.host_role<>v_role then raise exception 'Recover the original creation request before changing its details.'; end if;
      return jsonb_build_object('ok',true,'code',s.code,'key',secret);
    end if;
    if (select count(*) from officehours_private.sessions where created_at>now_at-interval '1 minute')>=10 then raise exception 'Too many new queues. Wait a minute and try again.'; end if;
    if (select count(*) from officehours_private.sessions)>=1000 then raise exception 'Queue capacity reached. Contact the operator.'; end if;
    loop
      v_code='';
      for i in 0..5 loop v_code=v_code||substr(alphabet,1+get_byte(extensions.gen_random_bytes(6),i)%length(alphabet),1); end loop;
      exit when not exists(select 1 from officehours_private.sessions where code=v_code);
    end loop;
    insert into officehours_private.sessions(code,host_key_hash,host_name,host_role,course_id,name) values(v_code,hashed,v_name,v_role,v_course,v_topic);
    insert into public.queue_signals values(v_code,1);
    return jsonb_build_object('ok',true,'code',v_code,'key',secret);
  end if;
  select * into s from officehours_private.sessions where code=v_code for update;
  if not found then raise exception 'No queue found with that code.'; end if;
  if p_event='session:watch' then return jsonb_build_object('ok',true)||officehours_private.queue_view(v_code,'public'); end if;
  if p_event in ('host:watch','host:action') then
    if s.host_key_hash is distinct from encode(extensions.digest(coalesce(p_payload->>'key',''),'sha256'),'hex') then raise exception 'This instructor link is not valid.'; end if;
    if p_event='host:watch' then return jsonb_build_object('ok',true)||officehours_private.queue_view(v_code,'host'); end if;
    action=p_payload->>'action';
    if action is null or action not in ('callNext','call','done','moveAside','returnToQueue','undoMoveAside','remove','end') then raise exception 'Unknown action.'; end if;
    if s.ended_at is not null then raise exception 'This queue has been closed.'; end if;
    if action='end' then
      update officehours_private.sessions set ended_at=now_at where code=v_code;
    else
      if action='callNext' then
        select * into e from officehours_private.entries where code=v_code and status='WAITING' order by order_key,id limit 1;
        if not found then raise exception 'Nobody is waiting.'; end if;
      else
        select * into e from officehours_private.entries where code=v_code and id::text=p_payload->>'studentId';
        if not found or e.status not in ('WAITING','CALLED','MOVED_ASIDE') then raise exception 'That student is not in the queue.'; end if;
      end if;
      if action in ('call','callNext') then
        if e.status<>'WAITING' then raise exception 'That student has already been called.'; end if;
        update officehours_private.entries set status='CALLED',called_at=now_at where id=e.id;
      elsif action='done' then
        update officehours_private.entries set status='DONE',finished_at=case when e.status='CALLED' then now_at else null end where id=e.id;
      elsif action='remove' then
        update officehours_private.entries set status='REMOVED',finished_at=now_at where id=e.id;
      elsif action='moveAside' then
        if e.status not in ('WAITING','CALLED') then raise exception 'That student is already moved aside.'; end if;
        update officehours_private.entries set status='MOVED_ASIDE' where id=e.id;
      elsif action in ('returnToQueue','undoMoveAside') then
        if e.status<>'MOVED_ASIDE' then raise exception 'That student is not in the moved-aside list.'; end if;
        select coalesce(min(order_key),1)-1 into next_order from officehours_private.entries where code=v_code and status='WAITING';
        update officehours_private.entries set status=case when action='returnToQueue' then 'WAITING' else 'CALLED' end,
          order_key=next_order,called_at=case when action='returnToQueue' then null else called_at end where id=e.id;
      end if;
    end if;
    changed=true;result='{}';
  elsif p_event='student:join' then
    secret=p_payload->>'idempotencyKey';
    if secret is null or secret !~ '^[A-Za-z0-9_-]{43}$' then raise exception 'A secure join recovery key is required.'; end if;
    hashed=encode(extensions.digest(secret,'sha256'),'hex');
    v_name=btrim(coalesce(p_payload->>'name',''));v_netid=btrim(coalesce(p_payload->>'netId',''));
    v_topic=btrim(coalesce(p_payload->>'topic',''));v_details=btrim(coalesce(p_payload->>'details',''));
    if length(v_name) not between 1 and 60 or length(v_netid) not between 1 and 20 or length(v_details)>280 then raise exception 'Enter a valid name, NetID and question details.'; end if;
    if v_topic not in ('Homework','Exam prep','Concept question','Debugging','Grades / logistics','Other') then raise exception 'Please choose a topic.'; end if;
    select * into e from officehours_private.entries where code=v_code and token_hash=hashed;
    if found then
      if e.name<>v_name or e.net_id<>v_netid or e.topic<>v_topic or e.details<>v_details then raise exception 'Recover the original join request before changing its details.'; end if;
      return jsonb_build_object('ok',true,'id',e.id,'token',secret);
    end if;
    if s.ended_at is not null then raise exception 'This queue has been closed.'; end if;
    if exists(select 1 from officehours_private.entries where code=v_code and lower(net_id)=lower(v_netid) and status in ('WAITING','CALLED','MOVED_ASIDE')) then raise exception 'That NetID is already in this queue.'; end if;
    if (select count(*) from officehours_private.entries where code=v_code)>=200 then raise exception 'This queue has reached its capacity.'; end if;
    if (select count(*) from officehours_private.entries where code=v_code and joined_at>now_at-interval '1 minute')>=60 then raise exception 'Too many joins. Wait a minute and try again.'; end if;
    select coalesce(max(order_key),0)+1 into next_order from officehours_private.entries where code=v_code;
    insert into officehours_private.entries(code,token_hash,name,net_id,topic,details,order_key) values(v_code,hashed,v_name,v_netid,v_topic,v_details,next_order) returning * into e;
    changed=true;result=jsonb_build_object('id',e.id,'token',secret);
  else
    select * into e from officehours_private.entries where code=v_code and id::text=p_payload->>'id' and token_hash=encode(extensions.digest(coalesce(p_payload->>'token',''),'sha256'),'hex');
    if not found then raise exception 'Your saved membership credentials are invalid.'; end if;
    if p_event='student:watch' then return jsonb_build_object('ok',true)||officehours_private.queue_view(v_code,'student',e.id); end if;
    -- Terminal reads are retained. Rejoin clears the local ticket, never history.
    if e.status in ('WAITING','CALLED','MOVED_ASIDE') then
      update officehours_private.entries set status='LEFT',finished_at=now_at where id=e.id;
      changed=true;
    end if;
    result='{}';
  end if;
  if changed then
    update officehours_private.sessions set revision=revision+1 where code=v_code returning revision into s.revision;
    update public.queue_signals set revision=s.revision where code=v_code;
  end if;
  return jsonb_build_object('ok',true)||result;
exception
  when raise_exception then return jsonb_build_object('ok',false,'error',sqlerrm);
  when others then return jsonb_build_object('ok',false,'error','Unable to process this request. Refresh the current queue before trying again.');
end $$;
