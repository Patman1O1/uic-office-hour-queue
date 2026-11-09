/*
 * Types and constants shared by the server (server/) and the client (src/).
 *
 * TypeScript `enum`s are not allowed under `erasableSyntaxOnly`, so the UML
 * enumerations are written as `as const` objects plus a matching union type.
 * They are used exactly like enums: `Role.TA`, `Status.WAITING`, etc.
 */

/** <<Enumeration>> Role — who is hosting the office hours. */
export const Role = {
  INSTRUCTOR: 'INSTRUCTOR',
  TA: 'TA',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

/**
 * <<Enumeration>> Status — where a student is in the office hours flow.
 *
 * WAITING and CALLED come from the UML diagram. The other three cover the
 * flows in the low-fidelity prototype:
 *   MOVED_ASIDE — no-show, parked in the "Moved aside" list (Fig. 20 / 25)
 *   DONE        — TA pressed "Mark Done" (Fig. 18 / 23, "Session complete")
 *   REMOVED     — TA deleted the entry from the queue
 */
export const Status = {
  WAITING: 'WAITING',
  CALLED: 'CALLED',
  MOVED_ASIDE: 'MOVED_ASIDE',
  DONE: 'DONE',
  REMOVED: 'REMOVED',
} as const;
export type Status = (typeof Status)[keyof typeof Status];

/** Help categories offered on the join form (I1: "if the concerns are categorized…"). */
export const TOPIC_CATEGORIES = [
  'Homework',
  'Exam prep',
  'Concept question',
  'Debugging',
  'Grades / logistics',
  'Other',
] as const;

/** Field limits, enforced on both sides. */
export const LIMITS = {
  name: 60,
  netId: 20,
  courseId: 30,
  sessionName: 60,
  details: 280,
} as const;

/** Used for estimated wait times until a few students have been helped. */
export const DEFAULT_SERVICE_MS = 5 * 60_000;

/* ------------------------------------------------------------------------ */
/* Views — what each kind of client is allowed to see                       */
/* ------------------------------------------------------------------------ */

/** Public information about a session (anyone with the join code). */
export interface SessionInfo {
  code: string;
  courseId: string;
  name: string;
  hostName: string;
  hostRole: Role;
  open: boolean;
  createdAt: number;
  endedAt: number | null;
  waitingCount: number;
  calledCount: number;
}

/** One row on the instructor dashboard. Topics are only ever sent to the host. */
export interface HostEntry {
  id: string;
  name: string;
  netId: string;
  topic: string;
  details: string;
  status: Status;
  joinedAt: number;
  calledAt: number | null;
  /** 1-based place among WAITING students, or null if not waiting. */
  position: number | null;
}

export interface HostView {
  session: SessionInfo;
  queue: HostEntry[];
  movedAside: HostEntry[];
  helpedCount: number;
  avgServiceMs: number;
}

/** What a single student sees about themselves. No other students' details. */
export interface StudentSelf {
  id: string;
  name: string;
  topic: string;
  status: Status;
  position: number | null;
  ahead: number;
  estWaitMs: number;
  joinedAt: number;
  calledAt: number | null;
}

export interface StudentView {
  session: SessionInfo;
  /** null if this student is no longer known to the session. */
  me: StudentSelf | null;
}

/* ------------------------------------------------------------------------ */
/* Socket.io messages                                                       */
/* ------------------------------------------------------------------------ */

export type Ack<T = object> = (res: ({ ok: true } & T) | { ok: false; error: string }) => void;

export interface CreateSessionRequest {
  hostName: string;
  role: Role;
  courseId: string;
  name: string;
}

export interface JoinRequest {
  code: string;
  name: string;
  netId: string;
  topic: string;
  details: string;
}

export interface StudentAuth {
  code: string;
  id: string;
  token: string;
}

export interface HostAuth {
  code: string;
  key: string;
}

export type HostActionType =
  | 'callNext'
  | 'call'
  | 'done'
  | 'moveAside'
  | 'returnToQueue'
  | 'undoMoveAside'
  | 'remove'
  | 'end';

export interface HostActionRequest extends HostAuth {
  action: HostActionType;
  studentId?: string;
}

export interface ClientToServerEvents {
  'host:create': (req: CreateSessionRequest, ack: Ack<{ code: string; key: string }>) => void;
  'host:watch': (req: HostAuth, ack: Ack<{ view: HostView }>) => void;
  'host:action': (req: HostActionRequest, ack: Ack) => void;
  'session:watch': (req: { code: string }, ack: Ack<{ session: SessionInfo }>) => void;
  'student:join': (req: JoinRequest, ack: Ack<{ id: string; token: string }>) => void;
  'student:watch': (req: StudentAuth, ack: Ack<{ view: StudentView }>) => void;
  'student:leave': (req: StudentAuth, ack: Ack) => void;
}

export interface ServerToClientEvents {
  'host:update': (view: HostView) => void;
  'session:update': (session: SessionInfo) => void;
  'student:update': (view: StudentView) => void;
}
