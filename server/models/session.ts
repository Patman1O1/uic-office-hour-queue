import { randomBytes } from 'node:crypto';
import { DEFAULT_SERVICE_MS } from '../../shared/protocol.ts';
import { Queue } from './queue.ts';
import { Status } from './status.ts';
import type { Host } from './host.ts';
import type { Student } from './student.ts';

export class QueueError extends Error {}

/** How many recent help sessions feed the estimated wait time. */
const SERVICE_SAMPLE_SIZE = 10;

/**
 * Session — one temporary office-hours queue.
 *
 * UML: - topic: String, - courseId: String, - host: Host, - queue: Queue<Student>
 *      + setName(name) / getName()   (the session name, stored as `topic`)
 * Session ◆—— Host     (composition)
 * Session ◇—— Student  (aggregation, 1 —— 0..*)
 *
 * Queue rules (R5 fair ordering, R7 management, R10 no-shows):
 *  - Students join at the back with status WAITING.
 *  - CALLED students sit at the front of the queue, ahead of everyone WAITING.
 *    "Call Next" calls the first WAITING student; the host may also call a
 *    specific student out of order (the owner override in R5).
 *  - "Mark Done" and "Remove" take a student out of the queue and archive them
 *    so their page can show "Session complete" / "Removed".
 *  - "Move Aside" parks a no-show in a separate list. "Return to Queue" puts
 *    them back at the front of the waiting line; "Undo" restores them as CALLED.
 *  - A student who leaves is forgotten entirely.
 */
export class Session {
  private _topic!: string;
  private readonly _courseId: string;
  private readonly _host: Host;
  private readonly _queue = new Queue<Student>();

  private readonly _code: string;
  private readonly _hostKey: string = randomBytes(18).toString('base64url');
  private readonly _createdAt: number = Date.now();
  private _endedAt: number | null = null;
  private readonly _movedAside: Student[] = [];
  private readonly _archive = new Map<string, Student>();
  private readonly _serviceTimes: number[] = [];
  private _helpedCount = 0;

  public constructor(host: Host, courseId: string, name: string, code: string) {
    this._host = host;
    this._courseId = courseId;
    this._code = code;
    this.setName(name);
  }

  /* ---- UML accessors ---------------------------------------------------- */

  public setName(name: string): void {
    this._topic = name;
  }

  public getName(): string {
    return this._topic;
  }

  public getCourseId(): string {
    return this._courseId;
  }

  public getHost(): Host {
    return this._host;
  }

  public getQueue(): Queue<Student> {
    return this._queue;
  }

  /* ---- Session state ---------------------------------------------------- */

  public getCode(): string {
    return this._code;
  }

  public checkHostKey(key: string): boolean {
    return typeof key === 'string' && key === this._hostKey;
  }

  public getHostKey(): string {
    return this._hostKey;
  }

  public isOpen(): boolean {
    return this._endedAt === null;
  }

  public getCreatedAt(): number {
    return this._createdAt;
  }

  public getEndedAt(): number | null {
    return this._endedAt;
  }

  public getMovedAside(): Student[] {
    return [...this._movedAside];
  }

  public getHelpedCount(): number {
    return this._helpedCount;
  }

  public waiting(): Student[] {
    return this._queue.filter((s) => s.getStatus() === Status.WAITING);
  }

  public called(): Student[] {
    return this._queue.filter((s) => s.getStatus() === Status.CALLED);
  }

  /** Any student this session still knows about (queue, moved aside, or archived). */
  public findStudent(id: string): Student | undefined {
    return (
      this._queue.find((s) => s.getId() === id) ??
      this._movedAside.find((s) => s.getId() === id) ??
      this._archive.get(id)
    );
  }

  /** Every student whose page should receive updates. */
  public allStudents(): Student[] {
    return [...this._queue, ...this._movedAside, ...this._archive.values()];
  }

  /* ---- Student actions ---------------------------------------------------- */

  public enqueue(student: Student, now = Date.now()): void {
    if (!this.isOpen()) throw new QueueError('This queue has been closed.');
    student.setStatus(Status.WAITING);
    student.setJoinedAt(now);
    student.setCalledAt(null);
    this._queue.enqueue(student);
  }

  /** The student gives up their spot; nothing about them is kept. */
  public leave(id: string): Student {
    const student =
      this._queue.remove((s) => s.getId() === id) ?? this.takeFromMovedAside(id);
    if (!student) {
      // Already done/removed: just forget them.
      const archived = this._archive.get(id);
      if (archived) {
        this._archive.delete(id);
        return archived;
      }
      throw new QueueError('You are not in this queue.');
    }
    return student;
  }

  /* ---- Host actions ------------------------------------------------------ */

  /** Calls the first WAITING student. Returns null if nobody is waiting. */
  public callNext(now = Date.now()): Student | null {
    this.assertOpen();
    const next = this._queue.find((s) => s.getStatus() === Status.WAITING);
    if (!next) return null;
    return this.call(next.getId(), now);
  }

  /** Calls a specific WAITING student, even out of order. */
  public call(id: string, now = Date.now()): Student {
    this.assertOpen();
    const found = this._queue.find((s) => s.getId() === id);
    if (!found) throw new QueueError('That student is not in the queue.');
    if (found.getStatus() !== Status.WAITING) {
      throw new QueueError(`${found.getName()} has already been called.`);
    }
    const student = this._queue.remove((s) => s === found)!;
    student.setStatus(Status.CALLED);
    student.setCalledAt(now);
    // Keep called students together at the front, in the order they were called.
    this._queue.insertAt(this.frontOfWaiting(), student);
    return student;
  }

  /** "Mark Done" — the student has been helped. */
  public markDone(id: string, now = Date.now()): Student {
    const student = this._queue.remove((s) => s.getId() === id) ?? this.takeFromMovedAside(id);
    if (!student) throw new QueueError('That student is not in the queue.');
    const calledAt = student.getCalledAt();
    if (calledAt !== null) {
      this._serviceTimes.push(Math.max(0, now - calledAt));
      if (this._serviceTimes.length > SERVICE_SAMPLE_SIZE) this._serviceTimes.shift();
    }
    student.setStatus(Status.DONE);
    this._archive.set(id, student);
    this._helpedCount++;
    return student;
  }

  /** "Move Aside" — a called student didn't show up (R10). */
  public moveAside(id: string): Student {
    const student = this._queue.remove((s) => s.getId() === id);
    if (!student) throw new QueueError('That student is not in the queue.');
    student.setStatus(Status.MOVED_ASIDE);
    this._movedAside.push(student);
    return student;
  }

  /** "Return to Queue" — a moved-aside student showed up; they go to the front of the waiting line. */
  public returnToQueue(id: string): Student {
    const student = this.takeFromMovedAside(id);
    if (!student) throw new QueueError('That student is not in the moved-aside list.');
    student.setStatus(Status.WAITING);
    student.setCalledAt(null);
    this._queue.insertAt(this.frontOfWaiting(), student);
    return student;
  }

  /** "Undo" right after Move Aside — restore them as CALLED, timer intact. */
  public undoMoveAside(id: string): Student {
    const student = this.takeFromMovedAside(id);
    if (!student) throw new QueueError('That student is not in the moved-aside list.');
    student.setStatus(Status.CALLED);
    this._queue.insertAt(this.frontOfWaiting(), student);
    return student;
  }

  /** Delete an entry without counting it as helped. */
  public remove(id: string): Student {
    const student = this._queue.remove((s) => s.getId() === id) ?? this.takeFromMovedAside(id);
    if (!student) throw new QueueError('That student is not in the queue.');
    student.setStatus(Status.REMOVED);
    this._archive.set(id, student);
    return student;
  }

  /** "End Queue" — no one else can join. Students still in line see the queue has ended. */
  public end(now = Date.now()): void {
    if (this._endedAt === null) this._endedAt = now;
  }

  /* ---- Position and wait estimates (R3, R4) ------------------------------ */

  /** 1-based place among WAITING students, or null if not waiting. */
  public positionOf(id: string): number | null {
    const i = this.waiting().findIndex((s) => s.getId() === id);
    return i === -1 ? null : i + 1;
  }

  /** Average time from "called" to "done" over recent students. */
  public averageServiceMs(): number {
    if (this._serviceTimes.length === 0) return DEFAULT_SERVICE_MS;
    const total = this._serviceTimes.reduce((a, b) => a + b, 0);
    return Math.round(total / this._serviceTimes.length);
  }

  /**
   * Rough wait for a WAITING student: everyone ahead of them in the waiting
   * line plus anyone currently being helped, times the average help time.
   */
  public estimatedWaitMs(id: string): number {
    const position = this.positionOf(id);
    if (position === null) return 0;
    const ahead = position - 1 + this.called().length;
    return ahead * this.averageServiceMs();
  }

  /* ---- helpers ----------------------------------------------------------- */

  private assertOpen(): void {
    if (!this.isOpen()) throw new QueueError('This queue has been closed.');
  }

  /** Index right after the last CALLED student. */
  private frontOfWaiting(): number {
    let i = 0;
    for (const s of this._queue) {
      if (s.getStatus() !== Status.CALLED) break;
      i++;
    }
    return i;
  }

  private takeFromMovedAside(id: string): Student | undefined {
    const i = this._movedAside.findIndex((s) => s.getId() === id);
    return i === -1 ? undefined : this._movedAside.splice(i, 1)[0];
  }
}
