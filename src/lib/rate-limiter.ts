import type { Clock } from './clock.js';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Fixed-window counter keyed by an arbitrary string.
 *
 * Behind an interface on purpose: the in-memory implementation is correct for a
 * single API instance. Running several instances means swapping in a shared
 * store (Redis or a Postgres table) here and nowhere else.
 */
export interface RateLimiter {
  /** Records one hit and reports whether it was within the limit. */
  hit(key: string): RateLimitResult;
  /** Reports whether the key is currently blocked, without recording a hit. */
  check(key: string): RateLimitResult;
}

export class MemoryRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private lastSweep = 0;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly clock: Clock,
  ) {}

  hit(key: string): RateLimitResult {
    const now = this.clock.now().getTime();
    this.sweep(now);
    const w = this.current(key, now);
    w.count += 1;
    this.windows.set(key, w);
    return this.result(w, now, w.count <= this.limit);
  }

  check(key: string): RateLimitResult {
    const now = this.clock.now().getTime();
    const w = this.current(key, now);
    return this.result(w, now, w.count < this.limit);
  }

  private current(key: string, now: number) {
    const w = this.windows.get(key);
    return w && w.resetAt > now ? w : { count: 0, resetAt: now + this.windowMs };
  }

  private result(w: { count: number; resetAt: number }, now: number, allowed: boolean) {
    return {
      allowed,
      remaining: Math.max(0, this.limit - w.count),
      retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((w.resetAt - now) / 1000)),
    };
  }

  /** Drops expired windows at most once a minute so memory stays bounded. */
  private sweep(now: number) {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [k, w] of this.windows) if (w.resetAt <= now) this.windows.delete(k);
  }
}
