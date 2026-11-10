import { useState, type FormEvent } from 'react';
import { Card, Header } from '../components/ui.tsx';
import { spacedCode, timeOfDay } from '../lib/format.ts';
import { Link } from '../components/Link.tsx';
import { navigate } from '../lib/router.ts';
import { hostedQueues } from '../lib/storage.ts';

/** Landing page: enter a join code, or start hosting. */
export function Home() {
  const [code, setCode] = useState('');
  const [hosted] = useState(() => hostedQueues.list());
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '');

  const join = (e: FormEvent) => {
    e.preventDefault();
    if (clean.length >= 4) navigate(`/q/${clean}`);
  };

  return (
    <>
      <Header />
      <main className="page page-narrow">
        <div className="hero">
          <h1 className="display">Skip the hallway.</h1>
          <p className="lede">Join the office hours line from your phone, see your place in real time, and get pinged when it's your turn.</p>
        </div>

        <Card>
          <h2>Join a queue</h2>
          <form onSubmit={join} className="code-form">
            <label htmlFor="join-code" className="sr-only">
              Join code
            </label>
            <input
              id="join-code"
              className="input input-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="ABC 234"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              maxLength={9}
              inputMode="text"
            />
            <button className="btn btn-primary" disabled={clean.length < 4}>
              Find Queue
            </button>
          </form>
          <p className="hint">The code is on the sign outside the room, or scan the QR code with your camera.</p>
        </Card>

        <Card className="card-quiet">
          <div className="row-between">
            <div>
              <h2>Hosting office hours?</h2>
              <p className="muted">Open a temporary queue in seconds. No accounts.</p>
            </div>
            <Link href="/new" className="btn btn-secondary">
              Create Queue
            </Link>
          </div>
          {hosted.length > 0 && (
            <div className="hosted">
              <h3>Your queues on this device</h3>
              <ul>
                {hosted.map((q) => (
                  <li key={q.code}>
                    <Link href={`/host/${q.code}`}>
                      <strong>{q.courseId}</strong> · {q.name}
                    </Link>
                    <span className="muted mono small">
                      {spacedCode(q.code)} · {timeOfDay(q.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </main>
    </>
  );
}
