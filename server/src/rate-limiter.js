import { QueueServiceError } from './queue-service.js';

// Per-application, fixed windows; no timers or unbounded per-socket history.
export class RateLimiter {
  #buckets = new Map();
  #config;
  #now;

  constructor(config, now = Date.now) {
    this.#config = config;
    this.#now = now;
  }

  consume(action, address) {
    const now = this.#now();
    for (const [key, bucket] of this.#buckets) {
      if (bucket.expiresAt <= now) this.#buckets.delete(key);
    }
    const key = `${action}:${address}`;
    let bucket = this.#buckets.get(key);
    if (!bucket) {
      if (this.#buckets.size >= this.#config.maxRateBuckets) {
        throw new QueueServiceError('RATE_LIMITED');
      }
      bucket = { count: 0, expiresAt: now + this.#config.rateWindowMs };
      this.#buckets.set(key, bucket);
    }
    const limit = action === 'create' ? this.#config.createLimit : this.#config.joinLimit;
    if (bucket.count >= limit) throw new QueueServiceError('RATE_LIMITED');
    bucket.count += 1;
  }
}
