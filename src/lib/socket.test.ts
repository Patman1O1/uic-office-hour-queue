import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const realtime = vi.hoisted(() => ({ subscribe: null as null | ((status: string) => void) }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({
  removeChannel: vi.fn(),
  channel: () => {
    const channel = { on: () => channel, subscribe: (callback: (status: string) => void) => {
      realtime.subscribe = callback;
      queueMicrotask(() => callback('SUBSCRIBED'));
    } };
    return channel;
  },
}) }));

const events = new EventTarget();
const fetchMock = vi.fn();
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers();
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'test');
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('window', { addEventListener: events.addEventListener.bind(events) });
  vi.stubGlobal('document', { visibilityState: 'hidden', addEventListener: events.addEventListener.bind(events) });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

it('recovers missed background updates and recalculates estimates at the same revision, rejecting older revisions', async () => {
  const socket = await import('./socket.ts');
  const view = (revision: number, wait: number) => ({ ok: true, view: {
    session: { code: 'ABC234', revision }, me: { id: 'student', estWaitMs: wait },
  } });
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => view(1, 60000) });
  const updates = vi.fn();
  socket.socket.on('student:update', updates);
  const stop = socket.onEveryConnect(() => {});
  await socket.request('student:watch', { code: 'ABC234', id: 'student', token: 'token' });
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => view(2, 30000) });
  await vi.advanceTimersByTimeAsync(15000);
  expect(updates).toHaveBeenLastCalledWith(expect.objectContaining({ me: { id: 'student', estWaitMs: 30000 } }));
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => view(2, 15000) });
  await vi.advanceTimersByTimeAsync(15000);
  expect(updates).toHaveBeenLastCalledWith(expect.objectContaining({ me: { id: 'student', estWaitMs: 15000 } }));
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => view(1, 60000) });
  await vi.advanceTimersByTimeAsync(15000);
  expect(updates).toHaveBeenCalledTimes(3);
  stop();
  await vi.advanceTimersByTimeAsync(15000);
  expect(fetchMock).toHaveBeenCalledTimes(4);
});
