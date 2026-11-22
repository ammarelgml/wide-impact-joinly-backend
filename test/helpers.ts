import { sql } from 'kysely';
import request from 'supertest';
import type { Express } from 'express';
import { afterAll, beforeEach } from 'vitest';
import { createApp } from '../src/app.js';
import type { Config } from '../src/config/config.js';
import { createDatabase } from '../src/db/database.js';
import { AppError } from '../src/lib/app-error.js';
import type { Clock } from '../src/lib/clock.js';
import { createLogger } from '../src/lib/logger.js';
import type { GoogleTokenVerifier } from '../src/modules/auth/google-verifier.js';

export const db = createDatabase(process.env.TEST_DATABASE_URL!, { max: 20 });

afterAll(() => db.destroy());

beforeEach(async () => {
  await sql`TRUNCATE users, classrooms, join_codes, enrollments, refresh_tokens CASCADE`.execute(
    db,
  );
});

/** A clock tests can move forward. */
export class TestClock implements Clock {
  private t = new Date('2026-11-23T08:00:00.000Z').getTime();
  now = () => new Date(this.t);
  advance(ms: number) {
    this.t += ms;
  }
}

/**
 * Stands in for Google. A "token" is `google:<sub>`; the email and name are
 * derived from the sub. Anything else fails verification, like a forged token.
 */
export const fakeGoogle: GoogleTokenVerifier = {
  async verify(idToken) {
    const m = /^google:([\w-]+)$/.exec(idToken);
    if (!m) throw new AppError('GOOGLE_TOKEN_INVALID', 'Google ID token could not be verified.');
    const sub = m[1]!;
    return { googleSub: sub, email: `${sub}@example.com`, name: `User ${sub}`, avatarUrl: null };
  },
};

export function testConfig(overrides: Partial<Config['auth']> = {}): Config {
  return {
    env: 'test',
    port: 0,
    logLevel: 'silent',
    databaseUrl: process.env.TEST_DATABASE_URL!,
    auth: {
      accessTokenSecret: 'test-secret-test-secret-test-secret-0000',
      accessTokenTtlSeconds: 900,
      refreshTokenTtlDays: 30,
      googleClientIds: ['test-client'],
      demoLoginEnabled: false,
      ...overrides,
    },
    joinCodeTtlHours: 24,
    trustProxy: 0,
    validateResponses: true,
  };
}

export function makeApp(
  opts: { clock?: TestClock; auth?: Partial<Config['auth']>; generateCode?: () => string } = {},
) {
  const clock = opts.clock ?? new TestClock();
  const app = createApp({
    config: testConfig(opts.auth),
    db,
    logger: createLogger('silent'),
    clock,
    google: fakeGoogle,
    ...(opts.generateCode && { generateCode: opts.generateCode }),
  });
  return { app, clock, http: request(app) };
}

export interface Session {
  token: string;
  refreshToken: string;
  userId: string;
}

export async function signIn(
  app: Express,
  sub: string,
  role: 'teacher' | 'student',
): Promise<Session> {
  const res = await request(app)
    .post('/v1/auth/google')
    .send({ idToken: `google:${sub}`, role });
  if (res.status !== 200)
    throw new Error(`sign-in failed: ${res.status} ${JSON.stringify(res.body)}`);
  return {
    token: res.body.accessToken,
    refreshToken: res.body.refreshToken,
    userId: res.body.user.id,
  };
}

export const bearer = (s: Session) => ({ Authorization: `Bearer ${s.token}` });

export async function createClassroom(app: Express, teacher: Session, name = 'Biology 101') {
  const res = await request(app).post('/v1/classrooms').set(bearer(teacher)).send({ name });
  if (res.status !== 201)
    throw new Error(`create failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { id: string; joinCode: { code: string; joinUrl: string } };
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
