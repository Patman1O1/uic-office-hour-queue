import { useState, type FormEvent } from 'react';
import { LIMITS, Role } from '../../shared/protocol.ts';
import { Banner, Card, Field, Header, WarnIcon } from '../components/ui.tsx';
import { navigate } from '../lib/router.ts';
import { request } from '../lib/socket.ts';
import { hostedQueues } from '../lib/storage.ts';

/** Fig. 5 / 13 — TA starts a new queue. */
export function CreateQueue() {
  const [hostName, setHostName] = useState('');
  const [role, setRole] = useState<Role>(Role.TA);
  const [courseId, setCourseId] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { code, key } = await request('host:create', { hostName, role, courseId, name });
      hostedQueues.add({ code, key, courseId: courseId.trim(), name: name.trim(), createdAt: Date.now() });
      navigate(`/host/${code}?key=${encodeURIComponent(key)}&created=1`, { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <>
      <Header />
      <main className="page page-narrow">
        <Card className="card-raised">
          <h1 className="h-card">Start office hours</h1>
          <p className="muted">You'll get a join code, link, and QR code to share with students.</p>
          {error && (
            <Banner tone="danger" icon={<WarnIcon />}>
              {error}
            </Banner>
          )}
          <form onSubmit={submit} className="form">
            <Field label="Course">
              {(id) => (
                <input id={id} className="input" value={courseId} onChange={(e) => setCourseId(e.target.value)} placeholder="CS 422" maxLength={LIMITS.courseId} required autoFocus />
              )}
            </Field>
            <Field label="Session name">
              {(id) => (
                <input id={id} className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Midterm review office hours" maxLength={LIMITS.sessionName} required />
              )}
            </Field>
            <Field label="Your name" hint="Students see this so they know who they're waiting for.">
              {(id) => (
                <input id={id} className="input" value={hostName} onChange={(e) => setHostName(e.target.value)} placeholder="Jane" maxLength={LIMITS.name} autoComplete="name" required />
              )}
            </Field>
            <fieldset className="field">
              <legend>You are the</legend>
              <div className="segmented">
                {[Role.TA, Role.INSTRUCTOR].map((r) => (
                  <label key={r} className={role === r ? 'is-active' : ''}>
                    <input type="radio" name="role" value={r} checked={role === r} onChange={() => setRole(r)} />
                    {r === Role.TA ? 'TA / tutor' : 'Instructor'}
                  </label>
                ))}
              </div>
            </fieldset>
            <button className="btn btn-primary btn-block" disabled={busy}>
              {busy ? 'Creating…' : 'Create Queue'}
            </button>
          </form>
        </Card>
      </main>
    </>
  );
}
