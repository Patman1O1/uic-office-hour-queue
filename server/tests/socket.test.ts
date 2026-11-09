import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  ClientToServerEvents,
  HostView,
  ServerToClientEvents,
  StudentView,
} from '../../shared/protocol.ts';
import { createApp, type App } from '../app.ts';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

let app: App;
let url: string;
const clients: Client[] = [];

beforeAll(async () => {
  app = createApp();
  await new Promise<void>((r) => app.httpServer.listen(0, r));
  url = `http://localhost:${(app.httpServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  clients.forEach((c) => c.disconnect());
  await app.close();
});

function client(): Client {
  const c: Client = connect(url, { transports: ['websocket'], forceNew: true });
  clients.push(c);
  return c;
}

/** Promise wrapper around an acked emit. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ask(c: Client, event: keyof ClientToServerEvents, payload: unknown): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Promise((resolve) => (c.emit as any)(event, payload, resolve));
}

function next<T>(c: Client, event: keyof ServerToClientEvents, until: (v: T) => boolean = () => true): Promise<T> {
  return new Promise((resolve) => {
    const h = (v: T) => {
      if (until(v)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        c.off(event, h as any);
        resolve(v);
      }
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    c.on(event, h as any);
  });
}

describe('socket API', () => {
  it('runs the full create → join → call → done flow', async () => {
    const ta = client();
    const created = await ask(ta, 'host:create', { hostName: 'Jane', role: 'TA', courseId: 'CS 422', name: 'Exam review' });
    expect(created.ok).toBe(true);
    const { code, key } = created;

    expect((await ask(ta, 'host:watch', { code, key: 'wrong' })).ok).toBe(false);
    const watched = await ask(ta, 'host:watch', { code, key });
    expect(watched.view.queue).toEqual([]);

    const john = client();
    const info = await ask(john, 'session:watch', { code: code.toLowerCase() });
    expect(info.session).toMatchObject({ courseId: 'CS 422', hostName: 'Jane', open: true, waitingCount: 0 });

    const hostUpdate = next<HostView>(ta, 'host:update');
    const joined = await ask(john, 'student:join', { code, name: 'John', netId: 'jdoe2', topic: 'Exam prep', details: 'Q3 on the practice exam' });
    expect(joined.ok).toBe(true);
    const hv = await hostUpdate;
    expect(hv.queue[0]).toMatchObject({ name: 'John', topic: 'Exam prep', details: 'Q3 on the practice exam', position: 1 });

    // Same NetID can't hold two spots.
    const dup = await ask(client(), 'student:join', { code, name: 'J', netId: 'JDOE2', topic: 'Other', details: '' });
    expect(dup).toEqual({ ok: false, error: 'JDOE2 is already in this queue.' });

    // A second device (or a reconnect) reclaims the spot with id + token.
    const johnPhone = client();
    const w = await ask(johnPhone, 'student:watch', { code, id: joined.id, token: joined.token });
    expect(w.view.me).toMatchObject({ status: 'WAITING', position: 1, ahead: 0 });
    // Students never see topics of others / NetIDs
    expect(JSON.stringify(w.view)).not.toContain('jdoe2');
    expect((await ask(johnPhone, 'student:watch', { code, id: joined.id, token: 'nope' })).ok).toBe(false);

    const calledP = next<StudentView>(johnPhone, 'student:update', (v) => v.me?.status === 'CALLED');
    expect((await ask(ta, 'host:action', { code, key, action: 'callNext' })).ok).toBe(true);
    expect((await calledP).me?.calledAt).toBeTypeOf('number');

    const doneP = next<StudentView>(johnPhone, 'student:update', (v) => v.me?.status === 'DONE');
    await ask(ta, 'host:action', { code, key, action: 'done', studentId: joined.id });
    await doneP;

    expect(await ask(ta, 'host:action', { code, key, action: 'callNext' })).toEqual({ ok: false, error: 'Nobody is waiting.' });

    // Students can't perform host actions
    expect((await ask(john, 'host:action', { code, key: joined.token, action: 'end' })).ok).toBe(false);

    const endedP = next<StudentView>(johnPhone, 'student:update', (v) => !v.session.open);
    await ask(ta, 'host:action', { code, key, action: 'end' });
    await endedP;
    const late = await ask(client(), 'student:join', { code, name: 'Late', netId: 'late1', topic: 'Other', details: '' });
    expect(late).toEqual({ ok: false, error: 'This queue has been closed.' });
  });

  it('validates input', async () => {
    const ta = client();
    expect(await ask(ta, 'host:create', { hostName: '', role: 'TA', courseId: 'x', name: 'y' })).toEqual({ ok: false, error: 'Please enter your name.' });
    const { code } = await ask(ta, 'host:create', { hostName: 'J', role: 'TA', courseId: 'x', name: 'y' });
    const s = client();
    expect((await ask(s, 'student:join', { code, name: 'A', netId: 'a', topic: 'Bribes', details: '' })).error).toBe('Please choose a topic.');
    expect((await ask(s, 'student:join', { code, name: 'A'.repeat(61), netId: 'a', topic: 'Other', details: '' })).ok).toBe(false);
    expect((await ask(s, 'session:watch', { code: 'ZZZZZZ' })).error).toBe('No queue found with that code.');
  });

  it('a student leaving updates positions for everyone behind them', async () => {
    const ta = client();
    const { code } = await ask(ta, 'host:create', { hostName: 'J', role: 'TA', courseId: 'x', name: 'y' });
    const a = client();
    const b = client();
    const ja = await ask(a, 'student:join', { code, name: 'A', netId: 'a', topic: 'Other', details: '' });
    const jb = await ask(b, 'student:join', { code, name: 'B', netId: 'b', topic: 'Other', details: '' });
    expect((await ask(b, 'student:watch', { code, ...jb })).view.me.position).toBe(2);
    const moved = next<StudentView>(b, 'student:update', (v) => v.me?.position === 1);
    expect((await ask(a, 'student:leave', { code, ...ja })).ok).toBe(true);
    await moved;
  });
});
