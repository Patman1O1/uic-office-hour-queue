import { randomInt } from 'node:crypto';
import { Host } from './models/host.ts';
import type { Session } from './models/session.ts';
import type { Role } from './models/role.ts';

/** No 0/O, 1/I/L — codes get read off a TV or a door sign. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

/** Queues are temporary (proposal: "flushed after each session"). */
const ENDED_TTL_MS = 2 * 60 * 60_000; // keep ended queues 2h so students see "ended"
const MAX_AGE_MS = 16 * 60 * 60_000; // drop anything older than 16h

/**
 * In-memory store of active sessions, keyed by join code.
 * Swap this for SQLite/Postgres later without touching the models.
 */
export class SessionStore {
  private readonly _sessions = new Map<string, Session>();

  public create(hostName: string, role: Role, courseId: string, name: string): Session {
    const host = new Host(hostName, role);
    const session = host.createQueue(courseId, name, this.newCode());
    this._sessions.set(session.getCode(), session);
    return session;
  }

  public get(code: string): Session | undefined {
    if (typeof code !== 'string') return undefined;
    return this._sessions.get(normalizeCode(code));
  }

  public get size(): number {
    return this._sessions.size;
  }

  /** Remove stale sessions. Returns the codes that were dropped. */
  public sweep(now = Date.now()): string[] {
    const dropped: string[] = [];
    for (const [code, s] of this._sessions) {
      const ended = s.getEndedAt();
      if ((ended !== null && now - ended > ENDED_TTL_MS) || now - s.getCreatedAt() > MAX_AGE_MS) {
        this._sessions.delete(code);
        dropped.push(code);
      }
    }
    return dropped;
  }

  private newCode(): string {
    for (;;) {
      let code = '';
      for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (!this._sessions.has(code)) return code;
    }
  }
}

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}
