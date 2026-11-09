import { Role } from './role.ts';
import { Session } from './session.ts';

/**
 * Host — the instructor or TA running office hours.
 *
 * UML: - name: String, - role: Role
 *      + setName / setRole / getName / getRole / createQueue()
 * Host 1 —— 0..* Session (a host can open several queues)
 * Host 1 —— 0..* Student (a host helps many students)
 */
export class Host {
  private _name!: string;
  private _role!: Role;

  public constructor(name: string, role: Role = Role.TA) {
    this.setName(name);
    this.setRole(role);
  }

  public setName(name: string): void {
    this._name = name;
  }

  public setRole(role: Role): void {
    this._role = role;
  }

  public getName(): string {
    return this._name;
  }

  public getRole(): Role {
    return this._role;
  }

  /**
   * Opens a new, empty office-hours queue hosted by this person.
   * `code` is the short join code; the SessionStore makes sure it is unique.
   */
  public createQueue(courseId: string, sessionName: string, code: string): Session {
    return new Session(this, courseId, sessionName, code);
  }
}
