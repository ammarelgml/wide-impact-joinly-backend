import { Writable } from 'node:stream';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from '../src/http/openapi.js';
import { decodeCursor, encodeCursor } from '../src/lib/cursor.js';
import { KeyedMutex } from '../src/lib/keyed-mutex.js';
import { REDACT_PATHS } from '../src/lib/logger.js';
import { MemoryRateLimiter } from '../src/lib/rate-limiter.js';
import { generateJoinCode } from '../src/modules/classrooms/join-code.js';
import { TestClock } from './helpers.js';

describe('generateJoinCode', () => {
  it('always yields 6 digits, keeping leading zeros', () => {
    expect(generateJoinCode(() => 42)).toBe('000042');
    expect(generateJoinCode(() => 999_999)).toBe('999999');
    for (let i = 0; i < 1000; i++) expect(generateJoinCode()).toMatch(/^\d{6}$/);
  });

  it('never issues the published demo code (security audit)', () => {
    const draws = [246810, 246810, 7];
    expect(generateJoinCode(() => draws.shift()!)).toBe('000007');
  });
});

describe('cursor', () => {
  it('round-trips and rejects garbage', () => {
    const t = new Date('2026-11-22T10:00:00.000Z');
    const id = '7b0e7c4c-4c1e-4b8a-9d3f-3a7f3c2b1a00';
    expect(decodeCursor(encodeCursor(t, id))).toEqual({ t, id });
    expect(() => decodeCursor('nope')).toThrow();
    expect(decodeCursor(undefined)).toBeUndefined();
  });
});

describe('MemoryRateLimiter', () => {
  it('blocks after the limit and resets after the window', () => {
    const clock = new TestClock();
    const rl = new MemoryRateLimiter(2, 60_000, clock);
    expect(rl.hit('k').allowed).toBe(true);
    expect(rl.hit('k').allowed).toBe(true);
    expect(rl.check('k').allowed).toBe(false);
    expect(rl.hit('k')).toMatchObject({ allowed: false, retryAfterSeconds: 60 });
    expect(rl.check('other').allowed).toBe(true);
    clock.advance(60_000);
    expect(rl.check('k').allowed).toBe(true);
  });
});

describe('log redaction', () => {
  it('never writes tokens or join codes', () => {
    let out = '';
    const sink = new Writable({ write: (chunk, _e, cb) => ((out += chunk.toString()), cb()) });
    const log = pino({ redact: { paths: REDACT_PATHS, censor: '[redacted]' } }, sink);
    log.info({
      req: { headers: { authorization: 'Bearer secret-access' } },
      body: { idToken: 'secret-id', refreshToken: 'secret-refresh', code: '482913' },
    });
    expect(out).not.toMatch(/secret|482913/);
    expect(out).toContain('[redacted]');
  });
});

describe('OpenAPI document', () => {
  it('documents all 18 operations with their error responses', () => {
    const doc = buildOpenApiDocument();
    const ops = Object.values(doc.paths).flatMap((p) => Object.values(p)) as Array<{
      operationId: string;
      responses: Record<string, unknown>;
    }>;
    expect(ops).toHaveLength(18);
    for (const op of ops) expect(Object.keys(op.responses)).toContain('500');
    const join = (
      doc.paths['/v1/enrollments'] as Record<string, { responses: Record<string, unknown> }>
    ).post!;
    expect(Object.keys(join.responses)).toEqual(
      expect.arrayContaining(['200', '201', '400', '401', '403', '404', '409', '410', '429']),
    );
    expect(doc.components.schemas).toHaveProperty('Problem');
  });

  it('only resolves internal $refs that exist', () => {
    const doc = buildOpenApiDocument();
    const refs = [...JSON.stringify(doc).matchAll(/"\$ref":"#\/components\/schemas\/(\w+)"/g)].map(
      (m) => m[1]!,
    );
    for (const r of refs) expect(doc.components.schemas).toHaveProperty(r);
  });
});

describe('KeyedMutex', () => {
  it('runs tasks for one key in order, keeps going after a failure, and frees idle keys', async () => {
    const mutex = new KeyedMutex();
    const order: string[] = [];
    const task =
      (name: string, ms: number, fail = false) =>
      () =>
        new Promise<string>((resolve, reject) =>
          setTimeout(() => {
            order.push(name);
            if (fail) reject(new Error(name));
            else resolve(name);
          }, ms),
        );
    const a = mutex.run('k', task('a', 20));
    const b = mutex.run('k', task('b', 1, true));
    const c = mutex.run('k', task('c', 1));
    const other = mutex.run('j', task('other', 1));
    await expect(a).resolves.toBe('a');
    await expect(b).rejects.toThrow('b');
    await expect(c).resolves.toBe('c');
    await other;
    expect(order).toEqual(['other', 'a', 'b', 'c']);
    await new Promise((r) => setTimeout(r, 0));
    expect((mutex as unknown as { tails: Map<string, unknown> }).tails.size).toBe(0);
  });
});
