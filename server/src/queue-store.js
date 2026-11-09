// Trusted server-side storage. Copies prevent callers from mutating committed data.
// Records contain secrets and must never be returned directly to clients.
export class InMemoryQueueStore {
  #queues = new Map();
  #studentCount = 0;

  get size() { return this.#queues.size; }

  get studentCount() { return this.#studentCount; }

  get(id) {
    const queue = this.#queues.get(id);
    return queue === undefined ? undefined : structuredClone(queue);
  }

  create(queue) {
    if (this.#queues.has(queue.id)) throw new Error('Queue ID already exists.');
    const copy = structuredClone(queue);
    this.#queues.set(queue.id, copy);
    this.#studentCount += copy.students.length;
  }

  save(queue) {
    if (!this.#queues.has(queue.id)) throw new Error('Queue does not exist.');
    const copy = structuredClone(queue);
    this.#studentCount += copy.students.length - this.#queues.get(queue.id).students.length;
    this.#queues.set(queue.id, copy);
  }
}
