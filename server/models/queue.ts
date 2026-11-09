/**
 * Queue<T> — the ordered first-come-first-served line from the UML diagram
 * (Session.queue: Queue<Student>).
 *
 * Besides plain FIFO operations it supports the few out-of-order moves the
 * instructor needs: removing someone from the middle (Mark Done, Remove,
 * Leave) and inserting at a given index (Return to Queue, calling a specific
 * student). Backed by an array; office-hours queues are small.
 */
export class Queue<T> implements Iterable<T> {
  private _items: T[] = [];

  /** Add to the back of the line. */
  public enqueue(item: T): void {
    this._items.push(item);
  }

  /** Remove and return the front of the line. */
  public dequeue(): T | undefined {
    return this._items.shift();
  }

  /** Front of the line without removing it. */
  public peek(): T | undefined {
    return this._items[0];
  }

  public get size(): number {
    return this._items.length;
  }

  public isEmpty(): boolean {
    return this._items.length === 0;
  }

  public find(predicate: (item: T) => boolean): T | undefined {
    return this._items.find(predicate);
  }

  public indexOf(predicate: (item: T) => boolean): number {
    return this._items.findIndex(predicate);
  }

  /** Remove the first matching item and return it. */
  public remove(predicate: (item: T) => boolean): T | undefined {
    const i = this._items.findIndex(predicate);
    if (i === -1) return undefined;
    return this._items.splice(i, 1)[0];
  }

  /** Insert at `index` (clamped to [0, size]). */
  public insertAt(index: number, item: T): void {
    const i = Math.max(0, Math.min(index, this._items.length));
    this._items.splice(i, 0, item);
  }

  public filter(predicate: (item: T) => boolean): T[] {
    return this._items.filter(predicate);
  }

  public clear(): void {
    this._items = [];
  }

  /** A copy, front first. */
  public toArray(): T[] {
    return [...this._items];
  }

  public [Symbol.iterator](): Iterator<T> {
    return this._items[Symbol.iterator]();
  }
}
