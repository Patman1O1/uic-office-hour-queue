import { useSyncExternalStore } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { Ack, ClientToServerEvents, ServerToClientEvents } from '../../shared/protocol.ts';

/** One shared connection per tab. In dev, Vite proxies /socket.io to the Node server. */
export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({
  reconnectionDelayMax: 4000,
});

type ReqOf<E extends keyof ClientToServerEvents> = Parameters<ClientToServerEvents[E]>[0];
type ResOf<E extends keyof ClientToServerEvents> =
  Parameters<ClientToServerEvents[E]>[1] extends Ack<infer T> ? T : never;

export class RequestError extends Error {}

/** Emit an event and wait for the server's `{ ok, ... }` reply. */
export function request<E extends keyof ClientToServerEvents>(
  event: E,
  payload: ReqOf<E>,
  timeoutMs = 8000,
): Promise<ResOf<E>> {
  return new Promise((resolve, reject) => {
    const emitter = socket.timeout(timeoutMs) as unknown as {
      emit(ev: string, p: unknown, cb: (err: Error | null, res: { ok: boolean; error?: string }) => void): void;
    };
    emitter.emit(event, payload, (err, res) => {
      if (err) reject(new RequestError("Can't reach the server. Check your connection and try again."));
      else if (!res.ok) reject(new RequestError(res.error ?? 'Something went wrong.'));
      else resolve(res as unknown as ResOf<E>);
    });
  });
}

/* ---- connection status (R11: show when updates are paused) ---------------- */

export type ConnectionState = 'connecting' | 'online' | 'offline';

let state: ConnectionState = socket.connected ? 'online' : 'connecting';
const listeners = new Set<() => void>();
const set = (s: ConnectionState) => {
  state = s;
  listeners.forEach((l) => l());
};
socket.on('connect', () => set('online'));
socket.on('disconnect', () => set('offline'));
socket.on('connect_error', () => set('offline'));
if (typeof window !== 'undefined') {
  // Show the banner the moment the device reports it lost its network,
  // instead of waiting for the socket heartbeat to time out.
  window.addEventListener('offline', () => set('offline'));
  window.addEventListener('online', () => (socket.connected ? set('online') : socket.connect()));
}
// Phones put background tabs to sleep; reconnect as soon as the page is visible again.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !socket.connected) socket.connect();
  });
}

export function useConnection(): ConnectionState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}

/** Run `fn` now and again after every reconnect (to re-join rooms and refresh state). */
export function onEveryConnect(fn: () => void): () => void {
  fn();
  socket.on('connect', fn);
  return () => {
    socket.off('connect', fn);
  };
}
