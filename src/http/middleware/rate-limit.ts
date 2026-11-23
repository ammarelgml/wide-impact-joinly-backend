import type { RequestHandler } from 'express';
import { AppError } from '../../lib/app-error.js';
import type { RateLimiter } from '../../lib/rate-limiter.js';

/** Records one hit for an arbitrary key and throws RATE_LIMITED when over the limit. */
export function enforceLimit(limiter: RateLimiter, key: string, message: string): void {
  const result = limiter.hit(key);
  if (!result.allowed) {
    throw new AppError('RATE_LIMITED', message, { retryAfterSeconds: result.retryAfterSeconds });
  }
}

/** Per-IP request limit. Client IP comes from req.ip, which honours TRUST_PROXY. */
export function limitByIp(limiter: RateLimiter, scope: string): RequestHandler {
  return (req, res, next) => {
    const result = limiter.hit(`${scope}:${req.ip}`);
    res.setHeader('RateLimit-Remaining', String(result.remaining));
    if (!result.allowed) {
      throw new AppError('RATE_LIMITED', 'Too many requests. Slow down and retry.', {
        retryAfterSeconds: result.retryAfterSeconds,
      });
    }
    next();
  };
}
