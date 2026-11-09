import { randomBytes, randomUUID } from 'node:crypto';
import { Status } from './status.ts';
import type { Session } from './session.ts';

/**
 * Student — someone waiting for help.
 *
 * UML: - name: String, - netId: String, - status: Status
 *      + setName / setNetId / setStatus / getName / getNetId / getStatus
 *      + joinQueue() / leaveQueue()
 *
 * Additions needed by the requirements:
 *   topic + details — R2/R7, the question topic the TA sees ahead of time
 *   id + token      — R11, lets the student's browser reclaim its spot after
 *                     a dropped connection or refresh, without an account
 *   joinedAt / calledAt — ordering, the "Waiting 2:10" timer, wait estimates
 */
export class Student {
  private readonly _id: string = randomUUID();
  private readonly _token: string = randomBytes(18).toString('base64url');
  private _name!: string;
  private _netId!: string;
  private _status: Status = Status.WAITING;
  private _topic: string;
  private _details: string;
  private _joinedAt = 0;
  private _calledAt: number | null = null;

  public constructor(name: string, netId: string, topic: string, details = '') {
    this.setName(name);
    this.setNetId(netId);
    this._topic = topic;
    this._details = details;
  }

  public setName(name: string): void {
    this._name = name;
  }

  public setNetId(netId: string): void {
    this._netId = netId;
  }

  public setStatus(status: Status): void {
    this._status = status;
  }

  public getName(): string {
    return this._name;
  }

  public getNetId(): string {
    return this._netId;
  }

  public getStatus(): Status {
    return this._status;
  }

  public getId(): string {
    return this._id;
  }

  public getToken(): string {
    return this._token;
  }

  public getTopic(): string {
    return this._topic;
  }

  public getDetails(): string {
    return this._details;
  }

  public getJoinedAt(): number {
    return this._joinedAt;
  }

  public setJoinedAt(time: number): void {
    this._joinedAt = time;
  }

  public getCalledAt(): number | null {
    return this._calledAt;
  }

  public setCalledAt(time: number | null): void {
    this._calledAt = time;
  }

  /** Get in line at the back of `session`'s queue. */
  public joinQueue(session: Session, now = Date.now()): void {
    session.enqueue(this, now);
  }

  /** Give up this student's spot in `session`. */
  public leaveQueue(session: Session): void {
    session.leave(this._id);
  }
}
