import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  LIMITS,
  Status,
  TOPIC_CATEGORIES,
  type SessionInfo,
  type StudentSelf,
} from '../../shared/protocol.ts';
import {
  Banner,
  Card,
  CheckIcon,
  ConnectionBanner,
  Field,
  Header,
  LiveIndicator,
  Modal,
  Spinner,
  WarnIcon,
} from '../components/ui.tsx';
import { approxMinutes, clock, ordinal, plural, roleLabel, useNow } from '../lib/format.ts';
import { alertStudent, askForNotifications, notificationPermission, primeSound, stopFlashingTitle } from '../lib/notify.ts';
import { Link } from '../components/Link.tsx';
import { onEveryConnect, pendingRequest, recoverPendingStudent, request, RequestError, socket, useConnection } from '../lib/socket.ts';
import { notificationPreference, profile, studentTicket } from '../lib/storage.ts';

/**
 * Student side (Storyboard 1):
 * join form (Fig. 9/22) → waiting (Fig. 10) → you're next (Fig. 11)
 * → session complete (Fig. 23), with leave (Fig. 12) and connection lost (Fig. 24).
 */
export function StudentPage({ code }: { code: string }) {
  const conn = useConnection();
  const now = useNow(1000);
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [me, setMe] = useState<StudentSelf | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // In-memory feedback for this join only; restored tickets don't show it.
  const [justJoined, setJustJoined] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);

  /* ---- live data ---------------------------------------------------------- */
  useEffect(() => {
    let live = true;
    const fresh = () => setLastUpdated(Date.now());
    const onSession = (s: SessionInfo) => {
      if (!live || s.code !== code) return;
      setInfo(s);
      fresh();
    };
    const onStudent = (v: { session: SessionInfo; me: StudentSelf | null }) => {
      if (!live || v.session.code !== code) return;
      setInfo(v.session);
      setMe(v.me);
      if (v.me?.status !== Status.WAITING) setJustJoined(false);
      setFatal(null);
      if (!v.session.open || !v.me || ![Status.WAITING, Status.CALLED, Status.MOVED_ASIDE].includes(v.me.status as 'WAITING' | 'CALLED' | 'MOVED_ASIDE')) setConfirmLeave(false);
      fresh();
    };
    const watchPublic = () =>
      request('session:watch', { code })
        .then(({ session }) => onSession(session))
        .catch((err: Error) => { if (live) setFatal(err.message); });

    socket.on('session:update', onSession);
    socket.on('student:update', onStudent);
    const stop = onEveryConnect(() => {
      void (async () => {
        let ticket = studentTicket.get(code);
        if (!ticket && pendingRequest('student:join', code)) {
          await watchPublic();
          await recoverPendingStudent(code);
          ticket = studentTicket.get(code);
        }
        if (!ticket) { await watchPublic(); return; }
        const { view } = await request('student:watch', { code, ...ticket });
        onStudent(view);
      })().catch((err: Error) => {
        if (!live) return;
        if (err instanceof RequestError && err.connection) setNotice(err.message);
        else setFatal(err.message);
      });
    });
    return () => {
      live = false;
      socket.off('session:update', onSession);
      socket.off('student:update', onStudent);
      stop();
    };
  }, [code]);

  /* ---- R8: alert on the important transitions ------------------------------ */
  const prev = useRef<{ id?: string; status?: Status; position?: number | null; calledAt?: number | null }>({});
  useEffect(() => {
    // A restored ticket bypasses Join, so unlock audio on the next interaction.
    document.addEventListener('pointerdown', primeSound, { once: true });
    document.addEventListener('keydown', primeSound, { once: true });
    return () => {
      stopFlashingTitle();
      document.removeEventListener('pointerdown', primeSound);
      document.removeEventListener('keydown', primeSound);
    };
  }, [code]);
  useEffect(() => {
    const p = prev.current;
    if (me && info?.open) {
      const host = info.hostName;
      if (me.status === Status.CALLED && (p.id !== me.id || p.status !== Status.CALLED || p.calledAt !== me.calledAt)) {
        void alertStudent("You're next!", `Head to ${host} now for ${info.courseId} office hours.`, { device: () => notificationPreference.get(code) });
      } else if (me.status === Status.WAITING && me.position === 1 && (p.position ?? 99) > 1) {
        void alertStudent("You're first in line", `${host} will call you soon — stay close.`, { loud: false, device: () => notificationPreference.get(code) });
      }
    }
    if (!info?.open || me?.status !== Status.CALLED) stopFlashingTitle();
    prev.current = { id: me?.id, status: me?.status, position: me?.position, calledAt: me?.calledAt };
  }, [me, info, code]);

  /* ---- actions ---------------------------------------------------------- */
  const forget = async () => {
    const ticket = studentTicket.get(code);
    const active = me && [Status.WAITING, Status.CALLED, Status.MOVED_ASIDE].some(status => status === me.status);
    if (active && ticket) await request('student:leave', { code, ...ticket });
    studentTicket.set(code, null);
    setJustJoined(false);
    setMe(null);
    await request('session:watch', { code });
  };
  const leave = async () => {
    if (leaving || conn !== 'online') return;
    setLeaving(true); setLeaveError(null);
    try {
      await forget();
      setNotice('You left the queue.');
      setConfirmLeave(false);
    } catch (error) { setLeaveError((error as Error).message); }
    finally { setLeaving(false); }
  };
  const rejoin = () => { void forget().catch(error => setNotice((error as Error).message)); };

  /* ---- render ----------------------------------------------------------- */
  if (fatal) {
    return (
      <>
        <Header />
        <main className="page page-narrow">
          <Card className="center">
            <div className="state-icon state-warning">
              <WarnIcon size={30} />
            </div>
            <h1 className="h-card">Queue not found</h1>
            <p className="muted">
              No queue is open with code <span className="mono">{code}</span>. It may have ended, or the code may be mistyped.
            </p>
            <Link href="/" className="btn btn-secondary">
              Enter a different code
            </Link>
          </Card>
        </main>
      </>
    );
  }

  if (!info) {
    return (
      <>
        <Header />
        <main className="page page-narrow">
          <Spinner label="Finding your queue…" />
          {notice && <Banner tone="warning">{notice}</Banner>}
          <button className="btn btn-secondary" onClick={() => window.location.reload()}>Retry connection</button>
        </main>
      </>
    );
  }

  const active = me && (me.status === Status.WAITING || me.status === Status.CALLED || me.status === Status.MOVED_ASIDE);
  const hostLabel = `${info.hostName} (${roleLabel(info.hostRole)})`;

  // Fig. 11 — the whole screen changes so it's obvious at a glance.
  if (me?.status === Status.CALLED && info.open) {
    return (
      <div className="called-screen">
        <ConnectionBanner state={conn} lastUpdated={lastUpdated} />
        <div className="called-inner" role="status" aria-live="polite">
          <div className="called-check">
            <CheckIcon size={44} />
          </div>
          <h1 className="display">You're Next!</h1>
          <p className="called-instruction">
            <strong>Please proceed to your TA now.</strong>
          </p>
          <p className="called-meta">
            {hostLabel}
            <br />
            {info.courseId} · {info.name}
            <br />
            Called {me.calledAt ? clock(now - me.calledAt) : ''} ago
          </p>
        </div>
        <button className="link-button" disabled={conn !== 'online'} onClick={() => { setLeaveError(null); setConfirmLeave(true); }}>
          Leave queue
        </button>
        {confirmLeave && <LeaveModal onStay={() => setConfirmLeave(false)} onLeave={leave} busy={leaving || conn !== 'online'} error={leaveError} />}
      </div>
    );
  }

  return (
    <>
      <Header />
      <main className="page page-narrow">
        <ConnectionBanner state={conn} lastUpdated={lastUpdated} />
        {notice && !me && (
          <Banner tone="info" action={<button className="icon-button" aria-label="Dismiss" onClick={() => setNotice(null)}>×</button>}>
            {notice}
          </Banner>
        )}

        <div className="session-heading">
          <p className="eyebrow">Course: {info.courseId}</p>
          <h1>{info.name}</h1>
          <p className="muted">
            with {hostLabel}
            {info.open && (
              <>
                {' · '}
                <span className="chip">{plural(info.waitingCount, 'student')} waiting</span>
              </>
            )}
          </p>
        </div>

        {justJoined && info.open && me?.status === Status.WAITING && (
          <Banner tone="success" icon={<CheckIcon />}>
            Successfully joined the queue!
          </Banner>
        )}

        {!info.open && active ? (
          <Card className="center">
            <h2>Office hours have ended</h2>
            <p className="muted">{info.hostName} closed the queue before you were called. Sorry! Try the next session.</p>
          </Card>
        ) : me?.status === Status.WAITING ? (
          <Waiting me={me} info={info} conn={conn} lastUpdated={lastUpdated} now={now} onLeave={() => setConfirmLeave(true)} />
        ) : me?.status === Status.MOVED_ASIDE ? (
          <Card className="card-amber center">
            <div className="state-icon state-warning">
              <WarnIcon size={30} />
            </div>
            <h2>You missed your turn</h2>
            <p>
              {info.hostName} called you but couldn't find you, so you've been moved aside. <strong>Let them know you're here</strong> and they'll put you back at the front of the line.
            </p>
            <button className="btn btn-ghost-danger" disabled={conn !== 'online'} onClick={() => { setLeaveError(null); setConfirmLeave(true); }}>
              Leave Queue
            </button>
          </Card>
        ) : me?.status === Status.DONE ? (
          <Card className="center">
            <div className="state-icon state-success">
              <CheckIcon size={30} />
            </div>
            <h2 className="h-big display">Session complete</h2>
            <p className="muted">{info.hostName} marked your visit as done. Good luck!</p>
            <div className="topic-card">
              <span className="muted small">You got help with</span>
              <strong>{me.topic}</strong>
            </div>
            {info.open && (
              <button className="btn btn-secondary" onClick={rejoin} disabled={conn !== 'online'}>
                Rejoin Queue
              </button>
            )}
          </Card>
        ) : me?.status === Status.LEFT ? (
          <Card className="center"><h2>You left the queue</h2><p>Your departure was confirmed.</p>{info.open && <button className="btn btn-secondary" onClick={rejoin} disabled={conn !== 'online'}>Rejoin Queue</button>}</Card>
        ) : me?.status === Status.REMOVED ? (
          <Card className="center">
            <h2>You were removed from the queue</h2>
            <p className="muted">{info.hostName} took you off the list. If you still need help, you can join again.</p>
            {info.open && (
              <button className="btn btn-secondary" onClick={rejoin} disabled={conn !== 'online'}>
                Rejoin Queue
              </button>
            )}
          </Card>
        ) : !info.open ? (
          <Card className="center">
            <h2>This queue is closed</h2>
            <p className="muted">These office hours have ended. Check your course page for the next session.</p>
          </Card>
        ) : (
          <JoinForm info={info} code={code} onJoined={() => { setNotice(null); setJustJoined(true); }} />
        )}

        {confirmLeave && active && info.open && <LeaveModal position={me?.position ?? null} onStay={() => setConfirmLeave(false)} onLeave={leave} busy={leaving || conn !== 'online'} error={leaveError} />}
      </main>
    </>
  );
}

/* ---- Fig. 9 / 22 ------------------------------------------------------------ */

function JoinForm({ info, code, onJoined }: { info: SessionInfo; code: string; onJoined: () => void }) {
  const saved = profile.get();
  const pending = pendingRequest('student:join', code);
  const conn = useConnection();
  const [name, setName] = useState(pending?.name ?? saved?.name ?? '');
  const [netId, setNetId] = useState(pending?.netId ?? saved?.netId ?? '');
  const [topic, setTopic] = useState(pending?.topic ?? '');
  const [details, setDetails] = useState(pending?.details ?? '');
  const permission = notificationPermission();
  const [alerts, setAlerts] = useState(() => notificationPreference.get(code));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    primeSound();
    notificationPreference.set(code, alerts);
    if (alerts) void askForNotifications();
    try {
      const ticket = await request('student:join', { code, name, netId, topic, details });
      studentTicket.set(code, { id: ticket.id, token: ticket.token });
      profile.set({ name: name.trim(), netId: netId.trim() });
      onJoined();
      // We already get a student:update from the server; this makes sure we're watching.
      await request('student:watch', { code, id: ticket.id, token: ticket.token }).catch(() => {});
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Card>
      {error && (
        <Banner tone="danger" icon={<WarnIcon />}>
          {error}
        </Banner>
      )}
      <form onSubmit={submit} className="form">
        <p className="hint">You’re joining <strong>{info.courseId}</strong>. The instructor selected this course for everyone in this queue.</p>
        <Field label="Your name">
          {(id) => <input id={id} className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={LIMITS.name} autoComplete="name" required />}
        </Field>
        <Field label="NetID">
          {(id) => (
            <input id={id} className="input" value={netId} onChange={(e) => setNetId(e.target.value)} maxLength={LIMITS.netId} autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="jdoe2" required />
          )}
        </Field>
        <Field label="What do you need help with?">
          {(id) => (
            <select id={id} className="input" value={topic} onChange={(e) => setTopic(e.target.value)} required>
              <option value="" disabled>
                Choose a topic
              </option>
              {TOPIC_CATEGORIES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Details" optional hint={`Only ${info.hostName} sees your topic and details — other students just see the line length.`}>
          {(id) => (
            <textarea id={id} className="input" rows={2} value={details} onChange={(e) => setDetails(e.target.value)} maxLength={LIMITS.details} placeholder="e.g. Homework 4, question 3" />
          )}
        </Field>
        {permission !== 'unsupported' && permission !== 'denied' && (
          <label className="check">
            <input type="checkbox" checked={alerts} onChange={(e) => setAlerts(e.target.checked)} />
            <span>
              Send browser notifications when it's my turn
              <span className="hint">Optional. The in-app alert and chime stay on. Browser delivery is best effort.</span>
            </span>
          </label>
        )}
        <button className="btn btn-primary btn-block btn-lg" disabled={busy || conn !== 'online'}>
          {busy ? 'Joining…' : 'Join Queue'}
        </button>
      </form>
    </Card>
  );
}

/* ---- Fig. 10 / 24 ------------------------------------------------------------ */

function Waiting({
  me,
  info,
  conn,
  lastUpdated,
  now,
  onLeave,
}: {
  me: StudentSelf;
  info: SessionInfo;
  conn: ReturnType<typeof useConnection>;
  lastUpdated: number | null;
  now: number;
  onLeave: () => void;
}) {
  const position = me.position ?? 0;
  const stale = conn !== 'online';

  return (
    <Card className="center waiting">
      <div className="row-between">
        <h2>You're in the queue</h2>
        <LiveIndicator state={conn} lastUpdated={lastUpdated} now={now} />
      </div>
      <div className={`position ${stale ? 'is-stale' : ''}`} aria-live="polite">
        <span className="position-number">#{position}</span>
        <span className="position-label">{ordinal(position)} in line</span>
      </div>
      <dl className="stats">
        <div>
          <dt>Ahead of you</dt>
          <dd>{me.ahead}</dd>
        </div>
        <div>
          <dt>Estimated wait</dt>
          <dd>{stale ? 'Unavailable offline' : me.estWaitMs === null ? 'Not enough information' : me.estWaitMs === 0 ? 'Next to be called' : approxMinutes(me.estWaitMs)}</dd>
        </div>
      </dl>
      {position === 1 && <Banner tone="success">You're first in line — stay close, {info.hostName} will call you next.</Banner>}
      <div className="topic-card">
        <span className="muted small">Your topic</span>
        <strong>{me.topic}</strong>
      </div>
      <p className="hint">Estimates use recent completed visits and the current visit’s elapsed time. Visit lengths and instructor call order can vary.</p>
      <NotificationSettings code={info.code} />
      <button className="btn btn-ghost-danger" onClick={onLeave} disabled={conn !== 'online'}>
        Leave Queue
      </button>
    </Card>
  );
}

function NotificationSettings({ code }: { code: string }) {
  const [enabled, setEnabled] = useState(() => notificationPreference.get(code));
  const [permission, setPermission] = useState(notificationPermission);
  useEffect(() => {
    const update = () => { setPermission(notificationPermission()); setEnabled(notificationPreference.get(code)); };
    window.addEventListener('focus', update);
    window.addEventListener('storage', update);
    return () => { window.removeEventListener('focus', update); window.removeEventListener('storage', update); };
  }, [code]);
  return (
    <div>
      <label className="check">
        <input type="checkbox" checked={enabled} onChange={e => {
          const checked = e.target.checked;
          setEnabled(checked);
          notificationPreference.set(code, checked);
          primeSound();
          if (checked) void askForNotifications().then(() => setPermission(notificationPermission()));
        }} />
        <span>Send browser notifications when it's my turn</span>
      </label>
      <p className="hint">
        {enabled && permission === 'denied' ? 'Notifications are blocked. Allow them in browser settings. ' : ''}
        {enabled && permission === 'unsupported' ? 'Browser notifications are unavailable on this device. ' : ''}
        {enabled && permission === 'default' ? 'Notification permission has not been granted. Toggle this option to try again. ' : ''}
        Keep this page open. The green alert and chime stay on; sound may require a tap after reloading.
        Background alerts depend on your browser and device. A closed or suspended page cannot reliably receive calls.
      </p>
    </div>
  );
}

/* ---- Fig. 12 --------------------------------------------------------------- */

function LeaveModal({ position, onStay, onLeave, busy, error }: { error?: string | null; position?: number | null; onStay: () => void; onLeave: () => void; busy: boolean }) {
  return (
    <Modal
      title="Leave the queue?"
      onClose={onStay}
      actions={
        <>
          <button className="btn btn-primary" onClick={onStay} data-autofocus>
            Stay in Queue
          </button>
          <button className="btn btn-outline-danger" onClick={onLeave} disabled={busy}>
            {busy ? 'Leaving…' : 'Leave Queue'}
          </button>
        </>
      }
    >
      {error && <Banner tone="danger">{error}</Banner>}
      <p>
        You'll lose your spot{position ? ` (#${position})` : ''}. If you rejoin later, you'll go to the back of the line.
      </p>
    </Modal>
  );
}
