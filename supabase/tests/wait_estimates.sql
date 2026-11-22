-- Run against a migrated local/test database as its owner. All fixtures roll back.
begin;
do $$
declare
  sid uuid;
  result jsonb;
  predicted bigint;
begin
  insert into officehours_private.sessions(code,host_key_hash,host_name,host_role,course_id,name)
    values ('R4TEST','r4-fixture','Test','TA','CS 422','Wait tests');
  insert into officehours_private.entries(code,token_hash,name,net_id,topic,order_key)
    values ('R4TEST','waiting1','First','first','Other',1) returning id into sid;
  result=officehours_private.queue_view('R4TEST','student',sid);
  assert result#>>'{view,session,courseId}'='CS 422','Queue course must be included';
  assert (result#>>'{view,me,estWaitMs}')::bigint=0,'First student in idle queue is next';
  insert into officehours_private.entries(code,token_hash,name,net_id,topic,order_key)
    values ('R4TEST','waiting2','Second','second','Other',2) returning id into sid;
  result=officehours_private.queue_view('R4TEST','student',sid);
  assert result#>>'{view,me,estWaitMs}' is null,'No made-up five minute default';
  insert into officehours_private.entries(code,token_hash,name,net_id,topic,status,order_key,called_at,finished_at)
    select 'R4TEST','sample'||i,'Sample','sample'||i,'Other','DONE',i+2,
      statement_timestamp()-interval '2 minutes',statement_timestamp()-interval '1 minute' from generate_series(1,3) i;
  result=officehours_private.queue_view('R4TEST','student',sid);
  assert (result#>>'{view,me,estWaitMs}')::bigint=60000,'One waiting visit ahead uses history';
  update officehours_private.entries set status='CALLED',called_at=statement_timestamp()-interval '30 seconds'
    where code='R4TEST' and token_hash='waiting1';
  result=officehours_private.queue_view('R4TEST','student',sid);
  predicted=(result#>>'{view,me,estWaitMs}')::bigint;
  assert predicted between 29000 and 31000,'Elapsed service time must be subtracted';
  update officehours_private.entries set called_at=statement_timestamp()-interval '2 minutes'
    where code='R4TEST' and token_hash='waiting1';
  result=officehours_private.queue_view('R4TEST','student',sid);
  assert result#>>'{view,me,estWaitMs}' is null,'Overrun cannot imply an immediate call';
  update officehours_private.entries set called_at=statement_timestamp()+interval '1 minute'
    where code='R4TEST' and token_hash='waiting1';
  result=officehours_private.queue_view('R4TEST','student',sid);
  assert result#>>'{view,me,estWaitMs}' is null,'Future called timestamps are invalid';
  update officehours_private.entries set status='CALLED' where code='R4TEST' and token_hash='sample1';
  result=officehours_private.queue_view('R4TEST','student',sid);
  assert result#>>'{view,me,estWaitMs}' is null,'Multiple called students are ambiguous';
  update officehours_private.entries set status='DONE' where code='R4TEST' and token_hash='sample1';
  update officehours_private.entries set status='WAITING',called_at=null where code='R4TEST' and token_hash='waiting1';
  update officehours_private.entries set finished_at=called_at where code='R4TEST' and token_hash='sample2';
  result=officehours_private.queue_view('R4TEST','student',sid);
  assert result#>>'{view,me,estWaitMs}' is null,'Invalid duration does not satisfy sample threshold';
  update officehours_private.sessions set ended_at=statement_timestamp() where code='R4TEST';
  result=officehours_private.queue_view('R4TEST','student',sid);
  assert result#>>'{view,me,estWaitMs}' is null,'Closed queues have no estimate';
end $$;
rollback;
