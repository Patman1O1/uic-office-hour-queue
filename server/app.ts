import { existsSync } from 'node:fs';
import { createServer, type Server as HttpServer } from 'node:http';
import path from 'node:path';
import express from 'express';
import { Server, type Socket } from 'socket.io';
import {
  LIMITS,
  Role,
  Status,
  TOPIC_CATEGORIES,
  type Ack,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '../shared/protocol.ts';
import { QueueError, type Session } from './models/session.ts';
import { Student } from './models/student.ts';
import { SessionStore } from './sessionStore.ts';
import { hostView, sessionInfo, studentView } from './views.ts';

type IO = Server<ClientToServerEvents, ServerToClientEvents>;
type ClientSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

export interface AppOptions {
  /** Folder with the built frontend (vite build). Served if it exists. */
  staticDir?: string;
  store?: SessionStore;
}

export interface App {
  httpServer: HttpServer;
  io: IO;
  store: SessionStore;
  close(): Promise<void>;
}

const rooms = {
  host: (code: string) => `host:${code}`,
  public: (code: string) => `public:${code}`,
  student: (id: string) => `student:${id}`,
};

/** Trim a client-supplied string and enforce a length limit. */
function text(value: unknown, max: number, field: string, required = true): string {
  const s = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (required && !s) throw new QueueError(`Please enter ${field}.`);
  if (s.length > max) throw new QueueError(`${field[0].toUpperCase()}${field.slice(1)} is too long (max ${max}).`);
  return s;
}

export function createApp(options: AppOptions = {}): App {
  const store = options.store ?? new SessionStore();
  const app = express();
  const httpServer = createServer(app);
  const io: IO = new Server(httpServer, {
    // Socket.io falls back to HTTP long-polling on networks that block websockets.
    connectionStateRecovery: { maxDisconnectionDuration: 2 * 60_000 },
    // Notice dead connections within ~20s so the "Connection lost" banner is accurate.
    pingInterval: 10_000,
    pingTimeout: 10_000,
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, sessions: store.size });
  });

  if (options.staticDir && existsSync(options.staticDir)) {
    const dir = options.staticDir;
    app.use(express.static(dir));
    // Single-page app: send index.html for /q/CODE, /host/CODE, etc.
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
      res.sendFile(path.join(dir, 'index.html'));
    });
  }

  /** Push fresh state to everyone looking at this session. */
  function broadcast(session: Session): void {
    const code = session.getCode();
    io.to(rooms.host(code)).emit('host:update', hostView(session));
    io.to(rooms.public(code)).emit('session:update', sessionInfo(session));
    for (const st of session.allStudents()) {
      io.to(rooms.student(st.getId())).emit('student:update', studentView(session, st.getId()));
    }
  }

  function getSession(code: unknown): Session {
    const session = typeof code === 'string' ? store.get(code) : undefined;
    if (!session) throw new QueueError('No queue found with that code.');
    return session;
  }

  function getHostSession(code: unknown, key: unknown): Session {
    const session = getSession(code);
    if (typeof key !== 'string' || !session.checkHostKey(key)) {
      throw new QueueError('This instructor link is not valid.');
    }
    return session;
  }

  function getStudent(session: Session, id: unknown, token: unknown): Student {
    const st = typeof id === 'string' ? session.findStudent(id) : undefined;
    if (!st || st.getToken() !== token) throw new QueueError('You are not in this queue.');
    return st;
  }

  /** Wrap a handler so thrown QueueErrors become `{ ok: false, error }`. */
  function handle<Req, Res extends object>(
    socket: ClientSocket,
    fn: (req: Req) => Res,
  ): (req: Req, ack: Ack<Res>) => void {
    return (req, ack) => {
      const reply: Ack<Res> = typeof ack === 'function' ? ack : () => {};
      try {
        reply({ ok: true, ...fn(req ?? ({} as Req)) });
      } catch (err) {
        if (err instanceof QueueError) reply({ ok: false, error: err.message });
        else {
          console.error(`[socket ${socket.id}]`, err);
          reply({ ok: false, error: 'Something went wrong. Please try again.' });
        }
      }
    };
  }

  io.on('connection', (socket) => {
    /* ---- Instructor ---------------------------------------------------- */

    socket.on(
      'host:create',
      handle(socket, (req) => {
        const hostName = text(req.hostName, LIMITS.name, 'your name');
        const role = req.role === Role.INSTRUCTOR ? Role.INSTRUCTOR : Role.TA;
        const courseId = text(req.courseId, LIMITS.courseId, 'a course');
        const name = text(req.name, LIMITS.sessionName, 'a session name');
        const session = store.create(hostName, role, courseId, name);
        console.log(`[queue ${session.getCode()}] created: ${courseId} — ${name} (${hostName})`);
        return { code: session.getCode(), key: session.getHostKey() };
      }),
    );

    socket.on(
      'host:watch',
      handle(socket, (req) => {
        const session = getHostSession(req.code, req.key);
        socket.join(rooms.host(session.getCode()));
        return { view: hostView(session) };
      }),
    );

    socket.on(
      'host:action',
      handle(socket, (req) => {
        const session = getHostSession(req.code, req.key);
        const id = typeof req.studentId === 'string' ? req.studentId : '';
        switch (req.action) {
          case 'callNext':
            if (!session.callNext()) throw new QueueError('Nobody is waiting.');
            break;
          case 'call':
            session.call(id);
            break;
          case 'done':
            session.markDone(id);
            break;
          case 'moveAside':
            session.moveAside(id);
            break;
          case 'returnToQueue':
            session.returnToQueue(id);
            break;
          case 'undoMoveAside':
            session.undoMoveAside(id);
            break;
          case 'remove':
            session.remove(id);
            break;
          case 'end':
            session.end();
            console.log(`[queue ${session.getCode()}] ended`);
            break;
          default:
            throw new QueueError('Unknown action.');
        }
        broadcast(session);
        return {};
      }),
    );

    /* ---- Students -------------------------------------------------------- */

    socket.on(
      'session:watch',
      handle(socket, (req) => {
        const session = getSession(req.code);
        socket.join(rooms.public(session.getCode()));
        return { session: sessionInfo(session) };
      }),
    );

    socket.on(
      'student:join',
      handle(socket, (req) => {
        const session = getSession(req.code);
        const name = text(req.name, LIMITS.name, 'your name');
        const netId = text(req.netId, LIMITS.netId, 'your NetID');
        const topic = text(req.topic, 40, 'a topic');
        if (!(TOPIC_CATEGORIES as readonly string[]).includes(topic)) throw new QueueError('Please choose a topic.');
        const details = text(req.details, LIMITS.details, 'details', false);

        // One spot per NetID, so nobody can hold two places in line.
        const existing = session
          .allStudents()
          .find((s) => s.getNetId().toLowerCase() === netId.toLowerCase() && isActive(s));
        if (existing) throw new QueueError(`${netId} is already in this queue.`);

        const student = new Student(name, netId, topic, details);
        student.joinQueue(session);
        socket.join(rooms.student(student.getId()));
        broadcast(session);
        return { id: student.getId(), token: student.getToken() };
      }),
    );

    socket.on(
      'student:watch',
      handle(socket, (req) => {
        const session = getSession(req.code);
        const st = getStudent(session, req.id, req.token);
        socket.join(rooms.student(st.getId()));
        socket.join(rooms.public(session.getCode()));
        return { view: studentView(session, st.getId()) };
      }),
    );

    socket.on(
      'student:leave',
      handle(socket, (req) => {
        const session = getSession(req.code);
        const st = getStudent(session, req.id, req.token);
        st.leaveQueue(session);
        socket.leave(rooms.student(st.getId()));
        broadcast(session);
        return {};
      }),
    );
  });

  const sweeper = setInterval(() => store.sweep(), 10 * 60_000);
  sweeper.unref();

  return {
    httpServer,
    io,
    store,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(sweeper);
        io.close(() => resolve());
      }),
  };
}

function isActive(s: Student): boolean {
  const status = s.getStatus();
  return status === Status.WAITING || status === Status.CALLED || status === Status.MOVED_ASIDE;
}
