/*
 * Browser storage is how the app works without accounts:
 *  - a student's {id, token} per queue lets them refresh, lose Wi-Fi, or
 *    close the tab and come back to the same spot (R11)
 *  - a host's {code, key} lets them reopen their dashboard
 * Storage can be unavailable (private mode, embedded views), so every access is guarded.
 */

const PREFIX = 'myofficehours:';

function read<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === null) window.localStorage.removeItem(PREFIX + key);
    else window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export interface StudentTicket {
  id: string;
  token: string;
}

export const studentTicket = {
  get: (code: string) => read<StudentTicket>(`student:${code}`),
  set: (code: string, t: StudentTicket | null) => write(`student:${code}`, t),
};

/** Last values typed into the join form, so rejoining is one tap. */
export interface Profile {
  name: string;
  netId: string;
}
export const profile = {
  get: () => read<Profile>('profile'),
  set: (p: Profile) => write('profile', p),
};

export interface HostedQueue {
  code: string;
  key: string;
  courseId: string;
  name: string;
  createdAt: number;
}

const HOSTED_MAX_AGE = 16 * 60 * 60_000;

export const hostedQueues = {
  list: (): HostedQueue[] =>
    (read<HostedQueue[]>('hosted') ?? []).filter((q) => Date.now() - q.createdAt < HOSTED_MAX_AGE),
  add: (q: HostedQueue) => write('hosted', [q, ...hostedQueues.list().filter((x) => x.code !== q.code)].slice(0, 10)),
  find: (code: string) => hostedQueues.list().find((q) => q.code === code) ?? null,
  remove: (code: string) => write('hosted', hostedQueues.list().filter((q) => q.code !== code)),
};

export const settings = {
  graceMinutes: () => read<number>('grace') ?? 5,
  setGraceMinutes: (m: number) => write('grace', m),
};
