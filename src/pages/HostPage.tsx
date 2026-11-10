import { useCallback, useEffect, useState } from 'react';
import { Status, type HostActionType, type HostEntry, type HostView } from '../../shared/protocol.ts';
import {
  Banner,
  Card,
  CheckIcon,
  CloseIcon,
  ConnectionBanner,
  CopyButton,
  Header,
  Modal,
  QrCode,
  QrIcon,
  Spinner,
  WarnIcon,
} from '../components/ui.tsx';
import { approxMinutes, clock, plural, roleLabel, spacedCode, timeOfDay, useNow } from '../lib/format.ts';
import logo from '../assets/university-logo.svg';
import { Link } from '../components/Link.tsx';
import { onEveryConnect, request, socket, useConnection } from '../lib/socket.ts';
import { hostedQueues, settings } from '../lib/storage.ts';

type Confirm = { kind: 'end' } | { kind: 'remove'; student: HostEntry };

/**
 * Instructor side (Storyboard 2):
 * share (Fig. 14) → manage (Fig. 15) → call next (Fig. 16)
 * → move aside (Fig. 25) → end queue (Fig. 26).
 */
export function HostPage({ code, hostKey, justCreated }: { code: string; hostKey: string; justCreated: boolean }) {
  const conn = useConnection();
  const now = useNow(1000);
  const [view, setView] = useState<HostView | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  // Read once: the URL flag is removed right away (below), which re-renders with justCreated=false.
  const [created] = useState(justCreated);
  const [showShare, setShowShare] = useState(justCreated);
  const [toast, setToast] = useState<{ text: string; tone: 'warning' | 'danger' | 'success'; undoId?: string } | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [grace, setGrace] = useState(settings.graceMinutes);

  useEffect(() => {
    // Drop "&created=1" so a refresh doesn't show the "Queue created" banner again.
    if (justCreated) window.history.replaceState(null, '', `/host/${code}#key=${encodeURIComponent(hostKey)}`);
  }, [justCreated, code, hostKey]);

  useEffect(() => {
    let live = true;
    const onUpdate = (v: HostView) => live && v.session.code === code && setView(v);
    socket.on('host:update', onUpdate);
    const stop = onEveryConnect(() => {
      request('host:watch', { code, key: hostKey })
        .then(({ view: v }) => {
          if (!live) return;
          setView(v);
          if (!hostedQueues.find(code)) {
            hostedQueues.add({ code, key: hostKey, courseId: v.session.courseId, name: v.session.name, createdAt: v.session.createdAt });
          }
        })
        .catch((err: Error) => { if (live) setFatal(err.message); });
    });
    return () => {
      live = false;
      socket.off('host:update', onUpdate);
      stop();
    };
  }, [code, hostKey]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.undoId ? 10_000 : 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const act = useCallback(
    async (action: HostActionType, student?: HostEntry) => {
      if (conn !== 'online' || busy) return;
      setBusy(student ? `${action}:${student.id}` : action);
      try {
        await request('host:action', { code, key: hostKey, action, studentId: student?.id });
        if (action === 'moveAside' && student) {
          setToast({ text: `${student.name} moved aside.`, tone: 'warning', undoId: student.id });
        } else if (action === 'undoMoveAside' || action === 'returnToQueue') {
          setToast(null);
        }
      } catch (err) {
        setToast({ text: (err as Error).message, tone: 'danger' });
      } finally {
        setBusy(null);
      }
    },
    [code, hostKey, conn, busy],
  );

  const joinUrl = `${window.location.origin}/q/${code}`;
  const hostUrl = `${window.location.origin}/host/${code}?key=${encodeURIComponent(hostKey)}`;

  if (fatal) {
    return (
      <>
        <Header />
        <main className="page page-narrow">
          <Card className="center">
            <div className="state-icon state-warning">
              <WarnIcon size={30} />
            </div>
            <h1 className="h-card">Can't open this dashboard</h1>
            <p className="muted">{fatal} The queue may have ended and been cleared, or the link is incomplete.</p>
            <Link href="/new" className="btn btn-primary">
              Start a new queue
            </Link>
          </Card>
        </main>
      </>
    );
  }

  if (!view) {
    return (
      <>
        <Header />
        <main className="page">
          <Spinner label="Opening dashboard…" />
        </main>
      </>
    );
  }

  const { session } = view;

  /* ---- Fig. 6 / 14: share ------------------------------------------------------ */
  if (showShare && session.open) {
    return (
      <>
        <Header />
        <main className="page page-narrow">
          {created && (
            <Banner tone="success" icon={<CheckIcon />}>
              <strong>Queue created.</strong> Students can join now.
            </Banner>
          )}
          <Card className="center share">
            <img src={logo} alt="University of Illinois Chicago" className="share-logo" />
            <p className="eyebrow">{session.courseId}</p>
            <h1 className="h-card">{session.name}</h1>
            <p className="muted">Scan to join, or go to the link and enter the code.</p>
            <QrCode value={joinUrl} size={260} />
            <div className="join-code" aria-label={`Join code ${code.split('').join(' ')}`}>
              {spacedCode(code)}
            </div>
            <div className="link-row">
              <code className="link-text">{joinUrl}</code>
              <CopyButton text={joinUrl} />
            </div>
            <p className="chip">{plural(session.waitingCount, 'student')} waiting</p>
            <button className="btn btn-primary btn-block btn-lg" onClick={() => setShowShare(false)}>
              Go to Dashboard
            </button>
          </Card>
          <Card className="card-quiet">
            <h3>Your instructor link</h3>
            <p className="muted small">Keep this private — anyone with it can manage the queue. It's also saved on this device.</p>
            <div className="link-row">
              <code className="link-text">{hostUrl}</code>
              <CopyButton text={hostUrl} label="Copy" />
            </div>
          </Card>
        </main>
      </>
    );
  }

  /* ---- Queue ended ---------------------------------------------------------- */
  if (!session.open) {
    return (
      <>
        <Header />
        <main className="page page-narrow">
          <Card className="center">
            <div className="state-icon state-success">
              <CheckIcon size={30} />
            </div>
            <h1 className="h-card">Office hours ended</h1>
            <p className="muted">
              {session.courseId} · {session.name}
              <br />
              {timeOfDay(session.createdAt)} – {session.endedAt ? timeOfDay(session.endedAt) : ''}
            </p>
            <dl className="stats">
              <div>
                <dt>Students helped</dt>
                <dd>{view.helpedCount}</dd>
              </div>
              <div>
                <dt>Avg. time each</dt>
                <dd>{view.helpedCount ? approxMinutes(view.avgServiceMs) : '—'}</dd>
              </div>
            </dl>
            <Link href="/new" className="btn btn-primary">
              Start a new queue
            </Link>
          </Card>
        </main>
      </>
    );
  }

  /* ---- Fig. 7 / 15 / 16 / 25: dashboard -------------------------------------------------- */
  const waitingCount = session.waitingCount;
  const graceMs = grace * 60_000;

  return (
    <>
      <Header>
        <div className="header-session">
          <span className="header-course">{session.courseId}</span>
          <span className="muted">{session.name}</span>
        </div>
        <button className="btn btn-secondary btn-sm header-code" onClick={() => setShowShare(true)} title="Show QR code and link">
          <QrIcon /> <span className="mono">{spacedCode(code)}</span>
        </button>
      </Header>

      <main className="page page-wide">
        <ConnectionBanner state={conn} lastUpdated={null} />

        <div className="toolbar">
          <div className="counter">
            <span className="counter-number">{waitingCount}</span>
            <span className="counter-label">waiting</span>
          </div>
          <div className="toolbar-meta muted small">
            {session.calledCount > 0 && <span>{session.calledCount} called · </span>}
            {view.helpedCount} helped · ~{Math.round(view.avgServiceMs / 60_000)} min each
            <br />
            {session.hostName} ({roleLabel(session.hostRole)})
          </div>
          <div className="toolbar-actions">
            <button className="btn btn-primary btn-lg" onClick={() => act('callNext')} disabled={waitingCount === 0 || !!busy || conn !== 'online'}>
              Call Next
            </button>
            <button className="btn btn-outline-danger" disabled={conn !== 'online' || !!busy} onClick={() => setConfirm({ kind: 'end' })}>
              End Queue
            </button>
          </div>
        </div>

        {toast && (
          <Banner
            tone={toast.tone}
            icon={toast.tone === 'danger' ? <WarnIcon /> : undefined}
            action={
              toast.undoId ? (
                <button className="link-button" onClick={() => act('undoMoveAside', { id: toast.undoId } as HostEntry)}>
                  Undo
                </button>
              ) : (
                <button className="icon-button" aria-label="Dismiss" onClick={() => setToast(null)}>
                  <CloseIcon />
                </button>
              )
            }
          >
            {toast.text}
          </Banner>
        )}

        {view.queue.length === 0 ? (
          <Card className="center empty">
            <h2>No one in line yet</h2>
            <p className="muted">
              Students join with code <strong className="mono">{spacedCode(code)}</strong> or the QR code.
            </p>
            <button className="btn btn-secondary" onClick={() => setShowShare(true)}>
              <QrIcon /> Show QR code
            </button>
          </Card>
        ) : (
          <div className="table" role="table" aria-label="Queue">
            <div className="tr th" role="row">
              <span role="columnheader">#</span>
              <span role="columnheader">Student</span>
              <span role="columnheader">Topic</span>
              <span role="columnheader">Joined</span>
              <span role="columnheader">Status</span>
              <span role="columnheader" className="sr-only">
                Actions
              </span>
            </div>
            {view.queue.map((s) => (
              <Row key={s.id} s={s} now={now} graceMs={graceMs} busy={conn !== 'online' ? 'offline' : busy} act={act} onRemove={() => setConfirm({ kind: 'remove', student: s })} />
            ))}
          </div>
        )}

        {view.movedAside.length > 0 && (
          <section className="aside-list">
            <h2>Moved aside</h2>
            <div className="table" role="table" aria-label="Moved aside">
              {view.movedAside.map((s) => (
                <Row key={s.id} s={s} now={now} graceMs={graceMs} busy={conn !== 'online' ? 'offline' : busy} act={act} onRemove={() => setConfirm({ kind: 'remove', student: s })} />
              ))}
            </div>
          </section>
        )}

        <div className="footer-settings muted small">
          <label>
            Flag no-shows after{' '}
            <select
              value={grace}
              onChange={(e) => {
                const m = Number(e.target.value);
                setGrace(m);
                settings.setGraceMinutes(m);
              }}
            >
              {[2, 3, 5, 10, 15].map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
            </select>
          </label>
        </div>
      </main>

      {confirm?.kind === 'end' && (
        <Modal
          title="End this queue?"
          onClose={() => setConfirm(null)}
          actions={
            <>
              <button className="btn btn-primary" data-autofocus onClick={() => setConfirm(null)}>
                Keep Queue Open
              </button>
              <button
                className="btn btn-outline-danger"
                onClick={async () => {
                  setConfirm(null);
                  await act('end');
                }}
              >
                End Queue
              </button>
            </>
          }
        >
          <p>
            {waitingCount + session.calledCount > 0
              ? `${plural(waitingCount + session.calledCount, 'student is', 'students are')} still in line. They'll be told office hours have ended, and no one else can join.`
              : 'No one else will be able to join.'}
          </p>
        </Modal>
      )}
      {confirm?.kind === 'remove' && (
        <Modal
          title={`Remove ${confirm.student.name}?`}
          onClose={() => setConfirm(null)}
          actions={
            <>
              <button className="btn btn-secondary" data-autofocus onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button
                className="btn btn-outline-danger"
                onClick={async () => {
                  const s = confirm.student;
                  setConfirm(null);
                  await act('remove', s);
                }}
              >
                Remove
              </button>
            </>
          }
        >
          <p>They'll be taken out of the queue without being marked as helped.</p>
        </Modal>
      )}
    </>
  );
}

function Row({
  s,
  now,
  graceMs,
  busy,
  act,
  onRemove,
}: {
  s: HostEntry;
  now: number;
  graceMs: number;
  busy: string | null;
  act: (a: HostActionType, s: HostEntry) => void;
  onRemove: () => void;
}) {
  const called = s.status === Status.CALLED;
  const aside = s.status === Status.MOVED_ASIDE;
  const sinceCall = s.calledAt ? now - s.calledAt : 0;
  const overdue = called && sinceCall > graceMs;
  const isBusy = (a: string) => busy === 'offline' || busy === `${a}:${s.id}`;

  return (
    <div className={`tr ${called ? 'is-called' : ''} ${overdue ? 'is-overdue' : ''} ${aside ? 'is-aside' : ''}`} role="row">
      <span className="td-pos mono" role="cell">
        {s.position ?? (called ? '▸' : '–')}
      </span>
      <span className="td-student" role="cell">
        <strong>{s.name}</strong>
        <span className="muted small mono">{s.netId}</span>
      </span>
      <span className="td-topic" role="cell">
        <span className="topic-tag">{s.topic}</span>
        {s.details && <span className="details">{s.details}</span>}
      </span>
      <span className="td-joined small" role="cell">
        <span>{timeOfDay(s.joinedAt)}</span>
        <span className="muted">{s.status === Status.WAITING ? `waiting ${clock(now - s.joinedAt)}` : ''}</span>
      </span>
      <span className="td-status" role="cell">
        {called ? (
          <>
            <span className={`pill ${overdue ? 'pill-amber' : 'pill-green'}`}>{overdue ? 'No-show?' : 'Called'}</span>
            <span className={`timer mono ${overdue ? 'is-overdue' : ''}`}>Waiting {clock(sinceCall)}</span>
          </>
        ) : aside ? (
          <span className="pill pill-amber">No-show</span>
        ) : (
          <span className="pill">Waiting</span>
        )}
      </span>
      <span className="td-actions" role="cell">
        {aside ? (
          <button className="btn btn-secondary btn-sm" onClick={() => act('returnToQueue', s)} disabled={isBusy('returnToQueue')}>
            Return to Queue
          </button>
        ) : (
          <>
            {called ? (
              <button className="btn btn-amber btn-sm" onClick={() => act('moveAside', s)} disabled={isBusy('moveAside')}>
                Move Aside
              </button>
            ) : (
              <button className="btn btn-secondary btn-sm" onClick={() => act('call', s)} disabled={isBusy('call')} title="Call this student now, out of order">
                Call
              </button>
            )}
            <button className={`btn btn-sm ${called ? 'btn-primary' : 'btn-secondary'}`} onClick={() => act('done', s)} disabled={isBusy('done')}>
              Mark Done
            </button>
          </>
        )}
        <button className="icon-button" disabled={busy === 'offline'} onClick={onRemove} aria-label={`Remove ${s.name}`} title="Remove from queue">
          <CloseIcon />
        </button>
      </span>
    </div>
  );
}
