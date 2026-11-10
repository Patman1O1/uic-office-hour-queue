import { useSyncExternalStore } from 'react';
import { createClient, type RealtimeChannel } from '@supabase/supabase-js';
import type { Ack, ClientToServerEvents, ServerToClientEvents } from '../../shared/protocol.ts';
import { hostedQueues, studentTicket } from './storage.ts';

// Preserve the application's typed request/update boundary while replacing the
// process-local Socket.IO transport with HTTP transactions + safe DB revisions.
type ReqOf<E extends keyof ClientToServerEvents> = Parameters<ClientToServerEvents[E]>[0];
type ResOf<E extends keyof ClientToServerEvents> = Parameters<ClientToServerEvents[E]>[1] extends Ack<infer T> ? T : never;
type Result = { ok: boolean; error?: string; [key: string]: unknown };
type Watch = { event: 'host:watch' | 'student:watch' | 'session:watch'; payload: Record<string, unknown>; identity: string; code: string; generation: number };
export type ConnectionState = 'connecting' | 'online' | 'offline';
export class RequestError extends Error {
  readonly connection: boolean;
  constructor(message: string, connection = false) { super(message); this.connection = connection; }
}
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const supabase = url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
let state: ConnectionState = navigator.onLine ? 'online' : 'offline';
const listeners = new Set<() => void>();
const hooks = new Set<() => void>();
const handlers = new Map<string, Set<(value: never) => void>>();
let channel: RealtimeChannel | null = null;
let watch: Watch | null = null;
let generation = 0;
let lastRevision = -1;
let latest: Result | null = null;
let refreshing: Promise<Result> | null = null;
let refreshAgain = false;
let subscribed = false;
const set = (next: ConnectionState) => { state = next; listeners.forEach(fn => fn()); };

export const socket = {
  on<E extends keyof ServerToClientEvents>(event: E, fn: ServerToClientEvents[E]) {
    const set = handlers.get(event) ?? new Set(); set.add(fn as (value: never) => void); handlers.set(event, set);
  },
  off<E extends keyof ServerToClientEvents>(event: E, fn: ServerToClientEvents[E]) { handlers.get(event)?.delete(fn as (value: never) => void); },
};
function emit(event: keyof ServerToClientEvents, value: unknown) { handlers.get(event)?.forEach(fn => fn(value as never)); }
function secureKey() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
function persist(name: string, value: unknown) {
  try { localStorage.setItem(`myofficehours:${name}`, JSON.stringify(value)); }
  catch { throw new RequestError('Allow browser storage before continuing so your queue access can be recovered safely.'); }
}
function remove(name: string) { try { localStorage.removeItem(`myofficehours:${name}`); } catch { /* A saved retry remains safe. */ } }
function pendingName(event: string, code?: string) { return event === 'host:create' ? 'pending:create' : `pending:join:${code}`; }
export function pendingRequest<E extends 'host:create' | 'student:join'>(event: E, code?: string): ReqOf<E> | null {
  try {
    const raw = localStorage.getItem(`myofficehours:${pendingName(event, code)}`);
    const value = raw ? JSON.parse(raw) : null;
    if (!value || typeof value !== 'object' || !/^[A-Za-z0-9_-]{43}$/.test(value.idempotencyKey)) return null;
    if (event === 'student:join' && value.code !== code) return null;
    return value;
  } catch { return null; }
}
async function raw(event: string, payload: unknown, timeoutMs = 10000): Promise<Result> {
  if (!navigator.onLine) throw new RequestError('Connection lost. Reconnect before making changes.', true);
  try {
    const response = await fetch('/api/queue', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, payload }), signal: AbortSignal.timeout(timeoutMs), cache: 'no-store',
    });
    const result = await response.json() as Result;
    if (!response.ok) throw new RequestError(result.error || 'The queue service is unavailable.', true);
    if (!result.ok) throw new RequestError(result.error || 'The request was not accepted.');
    return result;
  } catch (error) {
    if (error instanceof RequestError && !error.connection) throw error;
    set('offline');
    throw new RequestError('Confirmation was interrupted. Reconnect to check the current queue; your saved join request can be recovered safely.', true);
  }
}
function accept(result: Result, target: Watch): Result {
  if (watch?.identity !== target.identity || generation !== target.generation) throw new RequestError('The selected queue view changed.');
  const data = target.event === 'session:watch' ? result : result.view as { session: { revision: number }; me?: { id: string } };
  const session = (data as { session: { revision: number; code: string } }).session;
  if (session.code !== target.code) throw new RequestError('Unexpected queue response.');
  if (target.event === 'student:watch' && (data as { me?: { id: string } }).me?.id !== target.payload.id) throw new RequestError('Your saved membership credentials are invalid.');
  if (session.revision > lastRevision) {
    lastRevision = session.revision; latest = result;
    emit(target.event === 'session:watch' ? 'session:update' : target.event === 'host:watch' ? 'host:update' : 'student:update', target.event === 'session:watch' ? session : result.view);
  }
  return latest ?? result;
}
async function refresh(): Promise<Result> {
  if (!watch) throw new RequestError('No queue selected.');
  if (refreshing) { refreshAgain = true; return refreshing; }
  const target = watch;
  const job = (async () => {
    let result: Result;
    do {
      refreshAgain = false;
      result = accept(await raw(target.event, target.payload), target);
    } while (refreshAgain && watch?.identity === target.identity && generation === target.generation);
    if (subscribed) set('online');
    return result;
  })();
  refreshing = job;
  try { return await job; } finally { if (refreshing === job) refreshing = null; }
}
async function establish(event: Watch['event'], payload: Record<string, unknown>): Promise<Result> {
  if (!supabase) throw new RequestError('Supabase is not configured for this deployment.');
  const identity = JSON.stringify([event, payload.code, payload.id, payload.key, payload.token]);
  if (watch?.identity === identity && subscribed) return refresh();
  const previous = channel;
  const target: Watch = { event, payload, identity, code: String(payload.code), generation: ++generation };
  watch = target; lastRevision = -1; latest = null; refreshing = null; refreshAgain = false; subscribed = false;
  set('connecting');
  if (previous) void supabase.removeChannel(previous);
  const next = supabase.channel(`queue:${target.code}:${target.generation}`);
  channel = next;
  next.on('postgres_changes', { event: '*', schema: 'public', table: 'queue_signals', filter: `code=eq.${target.code}` }, () => {
    if (watch?.identity === identity && subscribed) void refresh().catch(() => set('offline'));
  });
  let connectedOnce = false;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { if (generation === target.generation) set('offline'); reject(new RequestError('Live connection could not be established. Reconnect to restore the queue.', true)); }, 10000);
    next.subscribe(status => {
      if (generation !== target.generation) return;
      if (status === 'SUBSCRIBED') {
        const reconnected = connectedOnce; connectedOnce = true; subscribed = true;
        void refresh().then(value => { clearTimeout(timeout); resolve(value); if (reconnected) hooks.forEach(fn => fn()); }).catch(error => { clearTimeout(timeout); reject(error); });
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        subscribed = false; set('offline');
      }
    });
  });
}
export async function recoverPendingStudent(code: string) {
  const pending = pendingRequest('student:join', code);
  if (pending) await request('student:join', pending);
}
export async function request<E extends keyof ClientToServerEvents>(event: E, input: ReqOf<E>, timeoutMs = 10000): Promise<ResOf<E>> {
  if (event === 'session:watch' || event === 'student:watch' || event === 'host:watch') return await establish(event, input as unknown as Record<string, unknown>) as unknown as ResOf<E>;
  if (!navigator.onLine || (state !== 'online' && !(event === 'host:create' && !watch))) throw new RequestError('Wait until the current queue is synchronized before making changes.', true);
  let payload = input as unknown as Record<string, unknown>;
  const creates = event === 'host:create' || event === 'student:join';
  let savedName = '';
  if (creates) {
    savedName = pendingName(event, payload.code as string | undefined);
    const pending = pendingRequest(event, payload.code as string | undefined) as Record<string, unknown> | null;
    if (localStorage.getItem(`myofficehours:${savedName}`) && !pending) throw new RequestError('Saved recovery details are invalid. Contact the instructor before starting another membership.');
    if (pending) {
      const fields = event === 'host:create' ? ['hostName', 'role', 'courseId', 'name'] : ['code', 'name', 'netId', 'topic', 'details'];
      if (fields.some(field => String(pending[field] ?? '').trim() !== String(payload[field] ?? '').trim())) throw new RequestError('A join or creation is awaiting confirmation. Recover the saved original details before changing them.');
      payload = pending;
    } else {
      payload = { ...payload, idempotencyKey: secureKey() };
      persist(savedName, payload);
    }
  }
  let result: Result;
  try { result = await raw(event, payload, timeoutMs); }
  catch (error) {
    // Explicit rejection commits nothing. Unknown outcomes retain the exact key.
    if (creates && error instanceof RequestError && !error.connection) remove(savedName);
    if (!creates && watch && navigator.onLine) await refresh().catch(() => {});
    throw error;
  }
  if (event === 'student:join') {
    const ticket = { id: String(result.id), token: String(result.token) };
    persist(`student:${payload.code}`, ticket); studentTicket.set(String(payload.code), ticket); remove(savedName);
    await establish('student:watch', { code: payload.code, ...ticket });
  } else if (event === 'host:create') {
    const hosted = { code: String(result.code), key: String(result.key), courseId: String(payload.courseId), name: String(payload.name), createdAt: Date.now() };
    persist('hosted', [hosted, ...hostedQueues.list().filter(queue => queue.code !== result.code)]);
    remove(savedName);
  } else if (watch) await refresh();
  return result as unknown as ResOf<E>;
}
export function useConnection(): ConnectionState {
  return useSyncExternalStore(callback => { listeners.add(callback); return () => { listeners.delete(callback); }; }, () => state);
}
export function onEveryConnect(fn: () => void): () => void {
  hooks.add(fn); fn();
  return () => {
    hooks.delete(fn);
    if (!hooks.size) {
      generation++; watch = null; subscribed = false; refreshing = null;
      if (channel && supabase) void supabase.removeChannel(channel);
      channel = null; set(navigator.onLine ? 'online' : 'offline');
    }
  };
}
window.addEventListener('offline', () => { subscribed = false; set('offline'); });
window.addEventListener('online', () => { hooks.forEach(fn => fn()); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state === 'offline' && navigator.onLine) hooks.forEach(fn => fn());
});
