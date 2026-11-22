import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { db, makeApp, MINUTE, signIn, bearer } from './helpers.js';

describe('POST /v1/auth/google', () => {
  it('asks a new user for a role, then creates the account with it', async () => {
    const { http } = makeApp();

    const first = await http.post('/v1/auth/google').send({ idToken: 'google:new-user' });
    expect(first.status).toBe(422);
    expect(first.body.code).toBe('ROLE_REQUIRED');
    expect(first.headers['content-type']).toMatch(/application\/problem\+json/);

    const second = await http
      .post('/v1/auth/google')
      .send({ idToken: 'google:new-user', role: 'teacher' });
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({
      isNewUser: true,
      user: { role: 'teacher', email: 'new-user@example.com' },
    });
    expect(second.body.accessToken).toEqual(expect.any(String));
    expect(second.body.refreshToken).toEqual(expect.any(String));
  });

  it('signs a returning user in and never changes their role', async () => {
    const { app, http } = makeApp();
    await signIn(app, 'ret', 'student');

    const res = await http.post('/v1/auth/google').send({ idToken: 'google:ret', role: 'teacher' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ isNewUser: false, user: { role: 'student' } });
  });

  it('rejects a token that fails Google verification', async () => {
    const { http } = makeApp();
    const res = await http.post('/v1/auth/google').send({ idToken: 'forged', role: 'teacher' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('GOOGLE_TOKEN_INVALID');
  });

  it('validates the body and rejects unknown fields', async () => {
    const { http } = makeApp();
    const res = await http
      .post('/v1/auth/google')
      .send({ idToken: 'google:x', role: 'admin', extra: 1 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.errors.map((e: { path: string }) => e.path).sort()).toEqual(['extra', 'role']);
  });

  it('handles two concurrent first sign-ins of the same account', async () => {
    const { http } = makeApp();
    const body = { idToken: 'google:race', role: 'student' };
    const [a, b] = await Promise.all([
      http.post('/v1/auth/google').send(body),
      http.post('/v1/auth/google').send(body),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.body.user.id).toBe(b.body.user.id);
    const users = await db
      .selectFrom('users')
      .select('id')
      .where('google_sub', '=', 'race')
      .execute();
    expect(users).toHaveLength(1);
  });
});

describe('access tokens', () => {
  it('requires a bearer token', async () => {
    const { http } = makeApp();
    const res = await http.get('/v1/me');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a tampered token', async () => {
    const { app, http } = makeApp();
    const s = await signIn(app, 'tamper', 'teacher');
    const [h, p] = s.token.split('.');
    const res = await http
      .get('/v1/me')
      .set({ Authorization: `Bearer ${h}.${p}.bm90LWEtc2lnbmF0dXJl` });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  it('reports expiry distinctly so the app knows to refresh', async () => {
    const { app, http, clock } = makeApp();
    const s = await signIn(app, 'exp', 'teacher');
    expect((await http.get('/v1/me').set(bearer(s))).status).toBe(200);

    clock.advance(16 * MINUTE);
    const res = await http.get('/v1/me').set(bearer(s));
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('TOKEN_EXPIRED');
  });
});

describe('refresh token rotation', () => {
  it('rotates: the new pair works and the old refresh token is spent', async () => {
    const { app, http } = makeApp();
    const s = await signIn(app, 'rot', 'student');

    const res = await http.post('/v1/auth/refresh').send({ refreshToken: s.refreshToken });
    expect(res.status).toBe(200);
    expect(res.body.refreshToken).not.toBe(s.refreshToken);
    expect(
      (await http.get('/v1/me').set({ Authorization: `Bearer ${res.body.accessToken}` })).status,
    ).toBe(200);
  });

  it('revokes the whole family when a rotated token is reused', async () => {
    const { app, http } = makeApp();
    const s = await signIn(app, 'theft', 'student');
    const rotated = await http.post('/v1/auth/refresh').send({ refreshToken: s.refreshToken });

    // An attacker replays the stolen, already-rotated token.
    const replay = await http.post('/v1/auth/refresh').send({ refreshToken: s.refreshToken });
    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe('REFRESH_TOKEN_INVALID');

    // The legitimate holder's newer token is now dead too: everyone signs in again.
    const legit = await http
      .post('/v1/auth/refresh')
      .send({ refreshToken: rotated.body.refreshToken });
    expect(legit.status).toBe(401);
  });

  it('stores only a hash of the refresh token', async () => {
    const { app } = makeApp();
    const s = await signIn(app, 'hash', 'teacher');
    const rows = await db.selectFrom('refresh_tokens').select('token_hash').execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token_hash.toString('base64url')).not.toBe(s.refreshToken);
    expect(rows[0]!.token_hash).toHaveLength(32);
  });

  it('rejects an expired refresh token', async () => {
    const { app, http, clock } = makeApp();
    const s = await signIn(app, 'old', 'teacher');
    clock.advance(31 * 24 * 60 * MINUTE);
    const res = await http.post('/v1/auth/refresh').send({ refreshToken: s.refreshToken });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('REFRESH_TOKEN_INVALID');
  });

  it('logout revokes the session and is idempotent', async () => {
    const { app, http } = makeApp();
    const s = await signIn(app, 'bye', 'teacher');
    const body = { refreshToken: s.refreshToken };
    expect((await http.post('/v1/auth/logout').set(bearer(s)).send(body)).status).toBe(204);
    expect((await http.post('/v1/auth/logout').set(bearer(s)).send(body)).status).toBe(204);
    expect((await http.post('/v1/auth/refresh').send(body)).status).toBe(401);
  });
});

describe('POST /v1/auth/demo', () => {
  it('does not exist unless DEMO_LOGIN_ENABLED', async () => {
    const { http } = makeApp();
    const res = await http.post('/v1/auth/demo').send({ account: 'teacher' });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('signs in as the seeded demo account when enabled', async () => {
    const { app } = makeApp({ auth: { demoLoginEnabled: true } });
    await db
      .insertInto('users')
      .values({ google_sub: 'demo:student', email: 'd@joinly.app', name: 'Demo', role: 'student' })
      .execute();
    const res = await request(app).post('/v1/auth/demo').send({ account: 'student' });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('student');
  });
});

describe('GET /v1/me', () => {
  it('returns the signed-in user', async () => {
    const { app, http } = makeApp();
    const s = await signIn(app, 'me', 'teacher');
    const res = await http.get('/v1/me').set(bearer(s));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: s.userId, role: 'teacher', name: 'User me' });
  });
});

describe('HTTP hardening', () => {
  it('rejects oversized and malformed bodies as problem details', async () => {
    const { http } = makeApp();
    const big = await http.post('/v1/auth/google').send({ idToken: 'x'.repeat(20_000) });
    expect(big.status).toBe(413);
    expect(big.body.code).toBe('PAYLOAD_TOO_LARGE');

    const bad = await http
      .post('/v1/auth/google')
      .set('Content-Type', 'application/json')
      .send('{"idToken":');
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('VALIDATION_FAILED');
  });

  it('answers unknown routes with 404 problem details and sets security headers', async () => {
    const { http } = makeApp();
    const res = await http.get('/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(res.headers['x-request-id']).toEqual(expect.any(String));
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
