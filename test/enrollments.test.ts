import { describe, expect, it } from 'vitest';
import { bearer, createClassroom, db, makeApp, MINUTE, signIn } from './helpers.js';

async function setup(opts: Parameters<typeof makeApp>[0] = {}) {
  const ctx = makeApp(opts);
  const teacher = await signIn(ctx.app, 'teacher', 'teacher');
  const student = await signIn(ctx.app, 'student', 'student');
  const classroom = await createClassroom(ctx.app, teacher);
  return { ...ctx, teacher, student, classroom, code: classroom.joinCode.code };
}

describe('preview', () => {
  it('shows the class without classmate details (D14)', async () => {
    const { http, student, code, classroom } = await setup();
    const res = await http.post('/v1/enrollments/preview').set(bearer(student)).send({ code });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      alreadyMember: false,
      classroom: {
        id: classroom.id,
        name: 'Biology 101',
        description: null,
        teacher: { name: 'User teacher', avatarUrl: null },
        studentCount: 0,
      },
    });
  });

  it('rejects malformed codes with a field error', async () => {
    const { http, student } = await setup();
    const res = await http
      .post('/v1/enrollments/preview')
      .set(bearer(student))
      .send({ code: '12345a' });
    expect(res.status).toBe(400);
    expect(res.body.errors[0].path).toBe('code');
  });
});

describe('join', () => {
  it('joins once and is idempotent on repeat', async () => {
    const { http, student, code } = await setup();
    const first = await http.post('/v1/enrollments').set(bearer(student)).send({ code, via: 'qr' });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      alreadyMember: false,
      joinedVia: 'qr',
      classroom: { studentCount: 1 },
    });

    const again = await http
      .post('/v1/enrollments')
      .set(bearer(student))
      .send({ code, via: 'code' });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({
      alreadyMember: true,
      joinedVia: 'qr',
      classroom: { studentCount: 1 },
    });

    const preview = await http.post('/v1/enrollments/preview').set(bearer(student)).send({ code });
    expect(preview.body.alreadyMember).toBe(true);
  });

  it('creates exactly one row under 10 concurrent joins', async () => {
    const { http, student, code } = await setup();
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        http.post('/v1/enrollments').set(bearer(student)).send({ code, via: 'qr' }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 200)).toHaveLength(9);
    const rows = await db.selectFrom('enrollments').selectAll().execute();
    expect(rows).toHaveLength(1);
  });

  it('refuses when the teacher closed joining, without counting as a failed guess', async () => {
    const { http, teacher, student, classroom, code } = await setup();
    await http
      .patch(`/v1/classrooms/${classroom.id}`)
      .set(bearer(teacher))
      .send({ joiningOpen: false });
    for (let i = 0; i < 7; i++) {
      const res = await http
        .post('/v1/enrollments')
        .set(bearer(student))
        .send({ code, via: 'code' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('JOINING_CLOSED');
    }
  });

  it('rate-limits failed guesses: the 6th within 15 minutes gets 429 with Retry-After', async () => {
    // Long-lived access token so the same session can be reused after the window.
    const { http, student, code, clock } = await setup({ auth: { accessTokenTtlSeconds: 3600 } });
    const wrong = code === '000000' ? '000001' : '000000';
    for (let i = 0; i < 5; i++) {
      const res = await http
        .post('/v1/enrollments/preview')
        .set(bearer(student))
        .send({ code: wrong });
      expect(res.body.code).toBe('JOIN_CODE_INVALID');
    }
    const blocked = await http
      .post('/v1/enrollments')
      .set(bearer(student))
      .send({ code, via: 'code' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('RATE_LIMITED');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(blocked.body.retryAfterSeconds).toBe(Number(blocked.headers['retry-after']));

    clock.advance(15 * MINUTE);
    const after = await http
      .post('/v1/enrollments')
      .set(bearer(student))
      .send({ code, via: 'code' });
    expect(after.status).toBe(201);
  });

  it('limits per student, not globally', async () => {
    const { app, http, student, code } = await setup();
    for (let i = 0; i < 5; i++) {
      await http
        .post('/v1/enrollments/preview')
        .set(bearer(student))
        .send({ code: code === '000000' ? '000001' : '000000' });
    }
    const other = await signIn(app, 'other-student', 'student');
    const res = await http.post('/v1/enrollments').set(bearer(other)).send({ code, via: 'code' });
    expect(res.status).toBe(201);
  });
});

describe('list and leave', () => {
  it('lists joined classrooms and leaves one', async () => {
    const { app, http, teacher, student, code } = await setup();
    const second = await createClassroom(app, teacher, 'History');
    await http.post('/v1/enrollments').set(bearer(student)).send({ code, via: 'code' });
    await http
      .post('/v1/enrollments')
      .set(bearer(student))
      .send({ code: second.joinCode.code, via: 'qr' });

    const list = await http.get('/v1/enrollments').set(bearer(student));
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(2);
    expect(list.body.items[0].classroom).not.toHaveProperty('students');

    expect((await http.delete(`/v1/enrollments/${second.id}`).set(bearer(student))).status).toBe(
      204,
    );
    expect((await http.delete(`/v1/enrollments/${second.id}`).set(bearer(student))).status).toBe(
      404,
    );
    expect((await http.get('/v1/enrollments').set(bearer(student))).body.items).toHaveLength(1);
  });

  it('removes enrollments when the classroom is deleted', async () => {
    const { http, teacher, student, classroom, code } = await setup();
    await http.post('/v1/enrollments').set(bearer(student)).send({ code, via: 'code' });
    await http.delete(`/v1/classrooms/${classroom.id}`).set(bearer(teacher));
    expect((await http.get('/v1/enrollments').set(bearer(student))).body.items).toHaveLength(0);
    const join = await http
      .post('/v1/enrollments')
      .set(bearer(student))
      .send({ code, via: 'code' });
    expect(join.body.code).toBe('JOIN_CODE_INVALID');
  });
});
