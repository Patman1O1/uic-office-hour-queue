import type { HostEntry, HostView, SessionInfo, StudentView } from '../shared/protocol.ts';
import type { Session } from './models/session.ts';
import type { Student } from './models/student.ts';

/*
 * Each audience gets its own projection of a Session. Question topics and
 * NetIDs only ever go to the host (proposal: "reasons for visiting would
 * remain visible only to the instructor").
 */

export function sessionInfo(s: Session): SessionInfo {
  return {
    code: s.getCode(),
    courseId: s.getCourseId(),
    name: s.getName(),
    hostName: s.getHost().getName(),
    hostRole: s.getHost().getRole(),
    open: s.isOpen(),
    createdAt: s.getCreatedAt(),
    endedAt: s.getEndedAt(),
    waitingCount: s.waiting().length,
    calledCount: s.called().length,
  };
}

function hostEntry(s: Session, st: Student): HostEntry {
  return {
    id: st.getId(),
    name: st.getName(),
    netId: st.getNetId(),
    topic: st.getTopic(),
    details: st.getDetails(),
    status: st.getStatus(),
    joinedAt: st.getJoinedAt(),
    calledAt: st.getCalledAt(),
    position: s.positionOf(st.getId()),
  };
}

export function hostView(s: Session): HostView {
  return {
    session: sessionInfo(s),
    queue: s.getQueue().toArray().map((st) => hostEntry(s, st)),
    movedAside: s.getMovedAside().map((st) => hostEntry(s, st)),
    helpedCount: s.getHelpedCount(),
    avgServiceMs: s.averageServiceMs(),
  };
}

export function studentView(s: Session, id: string): StudentView {
  const st = s.findStudent(id);
  if (!st) return { session: sessionInfo(s), me: null };
  const position = s.positionOf(id);
  return {
    session: sessionInfo(s),
    me: {
      id,
      name: st.getName(),
      topic: st.getTopic(),
      status: st.getStatus(),
      position,
      ahead: position === null ? 0 : position - 1,
      estWaitMs: s.estimatedWaitMs(id),
      joinedAt: st.getJoinedAt(),
      calledAt: st.getCalledAt(),
    },
  };
}
