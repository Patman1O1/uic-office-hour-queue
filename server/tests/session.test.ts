import { describe, expect, it } from 'vitest';
import { DEFAULT_SERVICE_MS, Role, Status } from '../../shared/protocol.ts';
import { Host } from '../models/host.ts';
import { Queue } from '../models/queue.ts';
import { QueueError, type Session } from '../models/session.ts';
import { Student } from '../models/student.ts';
import { SessionStore, normalizeCode } from '../sessionStore.ts';

function setup(names = ['Ann', 'Ben', 'Cal', 'Dee']) {
  const host = new Host('Jane', Role.TA);
  const session = host.createQueue('CS 422', 'Exam review', 'ABC234');
  const students = names.map((n, i) => {
    const s = new Student(n, n.toLowerCase() + i, 'Homework');
    s.joinQueue(session, 1000 + i);
    return s;
  });
  return { host, session, students };
}

const order = (session: Session) => session.getQueue().toArray().map((s) => s.getName());

describe('Queue<T>', () => {
  it('is first in, first out', () => {
    const q = new Queue<number>();
    q.enqueue(1);
    q.enqueue(2);
    q.enqueue(3);
    expect(q.peek()).toBe(1);
    expect(q.dequeue()).toBe(1);
    expect(q.toArray()).toEqual([2, 3]);
    expect(q.size).toBe(2);
  });

  it('removes from the middle and inserts at an index', () => {
    const q = new Queue<string>();
    ['a', 'b', 'c'].forEach((x) => q.enqueue(x));
    expect(q.remove((x) => x === 'b')).toBe('b');
    q.insertAt(0, 'z');
    q.insertAt(99, 'end');
    expect([...q]).toEqual(['z', 'a', 'c', 'end']);
    expect(q.remove((x) => x === 'nope')).toBeUndefined();
  });
});

describe('Host / Session (UML)', () => {
  it('Host.createQueue makes a session hosted by that host', () => {
    const { host, session } = setup([]);
    expect(session.getHost()).toBe(host);
    expect(session.getCourseId()).toBe('CS 422');
    expect(session.getName()).toBe('Exam review');
    expect(host.getRole()).toBe(Role.TA);
    expect(session.isOpen()).toBe(true);
    expect(session.getHostKey().length).toBeGreaterThan(20);
  });

  it('students join first-come-first-served (R5)', () => {
    const { session, students } = setup();
    expect(order(session)).toEqual(['Ann', 'Ben', 'Cal', 'Dee']);
    expect(students.map((s) => session.positionOf(s.getId()))).toEqual([1, 2, 3, 4]);
    expect(students.every((s) => s.getStatus() === Status.WAITING)).toBe(true);
  });

  it('a student can leave and everyone behind moves up (R9)', () => {
    const { session, students } = setup();
    students[1].leaveQueue(session);
    expect(order(session)).toEqual(['Ann', 'Cal', 'Dee']);
    expect(session.positionOf(students[3].getId())).toBe(3);
    expect(session.findStudent(students[1].getId())).toBeUndefined();
  });
});

describe('Calling and completing (R7)', () => {
  it('callNext calls the first waiting student', () => {
    const { session, students } = setup();
    const called = session.callNext(5000);
    expect(called).toBe(students[0]);
    expect(called?.getStatus()).toBe(Status.CALLED);
    expect(called?.getCalledAt()).toBe(5000);
    expect(session.positionOf(students[0].getId())).toBeNull();
    expect(session.positionOf(students[1].getId())).toBe(1);
  });

  it('callNext twice calls two students in order and keeps them at the front', () => {
    const { session } = setup();
    session.callNext();
    session.callNext();
    expect(order(session)).toEqual(['Ann', 'Ben', 'Cal', 'Dee']);
    expect(session.called().map((s) => s.getName())).toEqual(['Ann', 'Ben']);
  });

  it('host can call someone out of order (R5 override)', () => {
    const { session, students } = setup();
    session.call(students[2].getId());
    expect(order(session)).toEqual(['Cal', 'Ann', 'Ben', 'Dee']);
    expect(session.positionOf(students[0].getId())).toBe(1);
    expect(() => session.call(students[2].getId())).toThrow(QueueError);
  });

  it('callNext returns null when nobody is waiting', () => {
    const { session } = setup([]);
    expect(session.callNext()).toBeNull();
  });

  it('markDone archives the student as DONE and records help time', () => {
    const { session, students } = setup();
    session.callNext(10_000);
    session.markDone(students[0].getId(), 10_000 + 120_000);
    expect(order(session)).toEqual(['Ben', 'Cal', 'Dee']);
    expect(students[0].getStatus()).toBe(Status.DONE);
    expect(session.findStudent(students[0].getId())).toBe(students[0]);
    expect(session.getHelpedCount()).toBe(1);
    expect(session.averageServiceMs()).toBe(120_000);
  });

  it('remove takes a student out without counting them as helped', () => {
    const { session, students } = setup();
    session.remove(students[2].getId());
    expect(students[2].getStatus()).toBe(Status.REMOVED);
    expect(order(session)).toEqual(['Ann', 'Ben', 'Dee']);
    expect(session.getHelpedCount()).toBe(0);
  });
});

describe('No-shows (R10)', () => {
  it('move aside, then return to the front of the waiting line', () => {
    const { session, students } = setup();
    session.callNext(); // Ann
    session.callNext(); // Ben
    session.moveAside(students[0].getId());
    expect(session.getMovedAside()).toEqual([students[0]]);
    expect(students[0].getStatus()).toBe(Status.MOVED_ASIDE);
    expect(order(session)).toEqual(['Ben', 'Cal', 'Dee']);

    session.returnToQueue(students[0].getId());
    // Ben is still being helped; Ann is next in the waiting line.
    expect(order(session)).toEqual(['Ben', 'Ann', 'Cal', 'Dee']);
    expect(students[0].getStatus()).toBe(Status.WAITING);
    expect(session.positionOf(students[0].getId())).toBe(1);
  });

  it('undo restores a moved-aside student as CALLED with their timer', () => {
    const { session, students } = setup();
    session.callNext(7000);
    session.moveAside(students[0].getId());
    session.undoMoveAside(students[0].getId());
    expect(students[0].getStatus()).toBe(Status.CALLED);
    expect(students[0].getCalledAt()).toBe(7000);
    expect(order(session)[0]).toBe('Ann');
  });
});

describe('Estimated wait (R4)', () => {
  it('uses the default help time until someone has been helped', () => {
    const { session, students } = setup();
    expect(session.estimatedWaitMs(students[0].getId())).toBe(0);
    expect(session.estimatedWaitMs(students[3].getId())).toBe(3 * DEFAULT_SERVICE_MS);
  });

  it('counts students currently being helped and adapts to real help times', () => {
    const { session, students } = setup();
    session.callNext(0);
    session.markDone(students[0].getId(), 60_000); // 1 min
    session.callNext(60_000); // Ben being helped
    // Dee: Cal ahead + Ben being helped = 2 × 1 min
    expect(session.estimatedWaitMs(students[3].getId())).toBe(2 * 60_000);
  });
});

describe('Ending the queue', () => {
  it('blocks new joins and calls but keeps students for their final status', () => {
    const { session, students } = setup(['Ann']);
    session.end(99);
    expect(session.isOpen()).toBe(false);
    expect(session.getEndedAt()).toBe(99);
    expect(() => new Student('Zed', 'zed', 'Other').joinQueue(session)).toThrow(QueueError);
    expect(() => session.callNext()).toThrow(QueueError);
    expect(session.findStudent(students[0].getId())).toBe(students[0]);
  });
});

describe('SessionStore', () => {
  it('creates sessions with unique, readable codes', () => {
    const store = new SessionStore();
    const codes = new Set<string>();
    for (let i = 0; i < 200; i++) codes.add(store.create('Jane', Role.TA, 'CS 1', 'x').getCode());
    expect(codes.size).toBe(200);
    for (const c of codes) expect(c).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
  });

  it('finds sessions case-insensitively and ignores spaces', () => {
    const store = new SessionStore();
    const s = store.create('Jane', Role.TA, 'CS 1', 'x');
    const code = s.getCode();
    expect(store.get(code.toLowerCase())).toBe(s);
    expect(store.get(`${code.slice(0, 3)} ${code.slice(3)}`)).toBe(s);
    expect(normalizeCode(' ab-c ')).toBe('ABC');
  });

  it('sweeps queues that ended long ago', () => {
    const store = new SessionStore();
    const s = store.create('Jane', Role.TA, 'CS 1', 'x');
    s.end(Date.now());
    expect(store.sweep(Date.now() + 60_000)).toEqual([]);
    expect(store.sweep(Date.now() + 3 * 60 * 60_000)).toEqual([s.getCode()]);
    expect(store.size).toBe(0);
  });
});
