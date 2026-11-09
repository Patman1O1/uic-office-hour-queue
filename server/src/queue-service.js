import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { InMemoryQueueStore } from './queue-store.js';
import { resolveConfiguration } from './configuration.js';

const messages = {
  INVALID_PAYLOAD: 'Invalid request payload.',
  QUEUE_NOT_FOUND: 'Queue not found.',
  UNAUTHORIZED: 'Invalid credentials for this queue and role.',
  QUEUE_ENDED: 'This queue has ended.',
  QUEUE_EMPTY: 'No students are waiting.',
  STUDENT_ALREADY_CALLED: 'A student is already called.',
  STUDENT_NOT_FOUND: 'Student not found in this queue.',
  INVALID_STUDENT_STATE: 'This student cannot make that transition.',
  IDEMPOTENCY_CONFLICT: 'This join key was already used with different details.',
  RATE_LIMITED: 'Too many new requests. Wait before trying again.',
  CAPACITY_REACHED: 'The server or queue has reached its retained capacity.',
  INTERNAL_ERROR: 'Unable to process the request.',
};

export class QueueServiceError extends Error {
  constructor(code, field) {
    super(messages[code]);
    this.name = 'QueueServiceError';
    this.code = code;
    if (field !== undefined) this.field = field;
  }
}

function fail(code, field) {
  throw new QueueServiceError(code, field);
}

function envelope(payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    fail('INVALID_PAYLOAD');
  }
}

function fields(payload, allowed) {
  for (const key of Object.keys(payload)) {
    if (!allowed.includes(key)) fail('INVALID_PAYLOAD');
  }
}

function identifier(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail('INVALID_PAYLOAD', field);
  }
  return value;
}

function text(value, field, maximum) {
  if (typeof value !== 'string') fail('INVALID_PAYLOAD', field);
  const trimmed = value.trim();
  if ([...trimmed].length < 1 || [...trimmed].length > maximum) {
    fail('INVALID_PAYLOAD', field);
  }
  return trimmed;
}

function matchesToken(candidate, actual) {
  if (typeof candidate !== 'string') return false;
  const candidateBytes = Buffer.from(candidate);
  const actualBytes = Buffer.from(actual);
  return candidateBytes.length === actualBytes.length
    && timingSafeEqual(candidateBytes, actualBytes);
}

function isActive(student) {
  return student.status === 'waiting' || student.status === 'called';
}

// Explicit allowlists: private records/tokens must not leak through projections.
function publicQueue(queue) {
  return {
    queueId: queue.id,
    title: queue.name,
    status: queue.status,
    createdAt: queue.createdAt,
    endedAt: queue.endedAt,
    waitingCount: queue.students.filter((s) => s.status === 'waiting').length,
    calledCount: queue.students.filter((s) => s.status === 'called').length,
  };
}

function entries(queue) {
  let waitingPosition = 0;
  // Array insertion order is the FIFO sequence, including equal timestamps.
  return queue.students.map((student) => ({
    studentId: student.id,
    name: student.name,
    category: student.category,
    reason: student.reason,
    email: student.email,
    status: student.status,
    joinedAt: student.joinedAt,
    calledAt: student.calledAt,
    finishedAt: student.finishedAt,
    position: student.status === 'waiting' ? ++waitingPosition
      : student.status === 'called' ? 0 : null,
  }));
}

function instructorState(queue) {
  return {
    role: 'instructor',
    queue: publicQueue(queue),
    revision: queue.revision,
    students: entries(queue),
  };
}

function studentState(queue, student) {
  return {
    role: 'student',
    queue: publicQueue(queue),
    revision: queue.revision,
    student: entries(queue).find((entry) => entry.studentId === student.id),
  };
}

export class QueueService {
  #store;
  #now;
  #generateId;
  #generateToken;
  #limits;

  constructor({
    store = new InMemoryQueueStore(),
    now = () => new Date(),
    generateId = randomUUID,
    generateToken = () => randomBytes(32).toString('base64url'),
    limits = {},
  } = {}) {
    this.#store = store;
    this.#now = now;
    this.#generateId = generateId;
    this.#generateToken = generateToken;
    this.#limits = resolveConfiguration(limits);
  }

  #queue(payload) {
    envelope(payload);
    const id = identifier(payload.queueId, 'queueId');
    const queue = this.#store.get(id);
    if (!queue) fail('QUEUE_NOT_FOUND');
    return queue;
  }

  #instructor(payload) {
    const queue = this.#queue(payload);
    if (!matchesToken(payload.managementToken, queue.instructorToken)) fail('UNAUTHORIZED');
    return queue;
  }

  #member(queue, token) {
    const student = queue.students.find((s) => matchesToken(token, s.membershipToken));
    if (!student) fail('UNAUTHORIZED');
    return student;
  }

  #open(queue) {
    if (queue.status !== 'open') fail('QUEUE_ENDED');
  }

  #commit(queue) {
    queue.revision += 1;
    this.#store.save(queue);
  }

  createQueue(payload, { admit = () => {} } = {}) {
    envelope(payload);
    fields(payload, ['title']);
    const name = text(payload.title, 'title', 120);
    if (this.#store.size >= this.#limits.maxQueues) fail('CAPACITY_REACHED');
    admit();
    const id = this.#generateId();
    // A faulty injected generator must not overwrite an existing queue.
    if (this.#store.get(id)) fail('INTERNAL_ERROR');
    const queue = {
      id,
      name,
      status: 'open',
      createdAt: this.#now().toISOString(),
      endedAt: null,
      instructorToken: this.#generateToken(),
      students: [],
      revision: 1,
    };
    this.#store.create(queue);
    return {
      queueId: queue.id,
      managementToken: queue.instructorToken,
      state: instructorState(queue),
    };
  }

  getQueue(payload) {
    const queue = this.#queue(payload);
    fields(payload, ['queueId']);
    return { queue: publicQueue(queue), revision: queue.revision };
  }

  // Authentication + snapshot only; the transport adapter owns subscriptions.
  getState(payload) {
    const queue = this.#queue(payload);
    if (payload.role === 'instructor') {
      if (!matchesToken(payload.managementToken, queue.instructorToken)) fail('UNAUTHORIZED');
      fields(payload, ['queueId', 'role', 'managementToken']);
      return { state: instructorState(queue) };
    }
    if (payload.role === 'student') {
      const student = this.#member(queue, payload.membershipToken);
      fields(payload, ['queueId', 'role', 'membershipToken']);
      return { state: studentState(queue, student) };
    }
    fail('INVALID_PAYLOAD', 'role');
  }

  joinStudent(payload, { admit = () => {} } = {}) {
    const queue = this.#queue(payload);
    fields(payload, ['queueId', 'name', 'category', 'reason', 'email', 'idempotencyKey']);
    const name = text(payload.name, 'name', 100);
    const category = text(payload.category, 'category', 100);
    const reason = text(payload.reason, 'reason', 1000);
    let email = null;
    if (Object.hasOwn(payload, 'email')) {
      email = text(payload.email, 'email', 254);
      if (!/^[^@\s]+@[^@\s]+$/u.test(email)) fail('INVALID_PAYLOAD', 'email');
    }
    const key = payload.idempotencyKey;
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(key)
        || Buffer.from(key, 'base64url').toString('base64url') !== key) {
      fail('INVALID_PAYLOAD', 'idempotencyKey');
    }
    const joinRequestHash = createHash('sha256').update(key).digest('hex');
    const existing = queue.students.find((s) => s.joinRequestHash === joinRequestHash);
    if (existing) {
      if (existing.name !== name || existing.category !== category
          || existing.reason !== reason || existing.email !== email) {
        fail('IDEMPOTENCY_CONFLICT');
      }
      // Recover the original credentials even after leave/end, without rejoining.
      return this.#joined(queue, existing);
    }
    this.#open(queue);
    if (queue.students.length >= this.#limits.maxStudentsPerQueue
        || this.#store.studentCount >= this.#limits.maxStudentsTotal) fail('CAPACITY_REACHED');
    admit();
    const id = this.#generateId();
    const membershipToken = this.#generateToken();
    if (queue.students.some((s) => s.id === id || s.membershipToken === membershipToken)
        || membershipToken === queue.instructorToken) fail('INTERNAL_ERROR');
    const student = {
      id,
      membershipToken,
      joinRequestHash,
      name,
      category,
      reason,
      email,
      status: 'waiting',
      joinedAt: this.#now().toISOString(),
      calledAt: null,
      finishedAt: null,
    };
    queue.students.push(student);
    this.#commit(queue);
    return this.#joined(queue, student);
  }

  #joined(queue, student) {
    return {
      queueId: queue.id,
      studentId: student.id,
      membershipToken: student.membershipToken,
      state: studentState(queue, student),
    };
  }

  callNext(payload) {
    const queue = this.#instructor(payload);
    fields(payload, ['queueId', 'managementToken']);
    this.#open(queue);
    if (queue.students.some((s) => s.status === 'called')) fail('STUDENT_ALREADY_CALLED');
    const student = queue.students.find((s) => s.status === 'waiting');
    if (!student) fail('QUEUE_EMPTY');
    const calledAt = this.#now().toISOString();
    student.status = 'called';
    student.calledAt = calledAt;
    this.#commit(queue);
    return { state: instructorState(queue) };
  }

  #finish(payload, status) {
    const queue = this.#instructor(payload);
    fields(payload, ['queueId', 'managementToken', 'studentId']);
    identifier(payload.studentId, 'studentId');
    this.#open(queue);
    const student = queue.students.find((s) => s.id === payload.studentId);
    if (!student) fail('STUDENT_NOT_FOUND');
    if (status === 'done' ? student.status !== 'called' : !isActive(student)) {
      fail('INVALID_STUDENT_STATE');
    }
    const finishedAt = this.#now().toISOString();
    student.status = status;
    student.finishedAt = finishedAt;
    this.#commit(queue);
    return { state: instructorState(queue) };
  }

  completeStudent(payload) {
    return this.#finish(payload, 'done');
  }

  removeStudent(payload) {
    return this.#finish(payload, 'removed');
  }

  leaveStudent(payload) {
    const queue = this.#queue(payload);
    const student = this.#member(queue, payload.membershipToken);
    fields(payload, ['queueId', 'membershipToken']);
    this.#open(queue);
    if (!isActive(student)) fail('INVALID_STUDENT_STATE');
    const finishedAt = this.#now().toISOString();
    student.status = 'left';
    student.finishedAt = finishedAt;
    this.#commit(queue);
    return { state: studentState(queue, student) };
  }

  endQueue(payload) {
    const queue = this.#instructor(payload);
    fields(payload, ['queueId', 'managementToken']);
    this.#open(queue);
    const endedAt = this.#now().toISOString();
    queue.status = 'ended';
    queue.endedAt = endedAt;
    for (const student of queue.students) {
      if (isActive(student)) {
        student.status = 'queue-ended';
        student.finishedAt = endedAt;
      }
    }
    this.#commit(queue);
    return { state: instructorState(queue) };
  }
}
