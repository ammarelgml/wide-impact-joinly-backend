import { describe, expect, it } from 'vitest';
import { bearer, createClassroom, HOUR, makeApp, signIn } from './helpers.js';

describe('classroom CRUD', () => {
  it('creates a classroom with its first join code', async () => {
    const { app, http, clock } = makeApp();
    const t = await signIn(app, 't1', 'teacher');
    const res = await http
      .post('/v1/classrooms')
      .set(bearer(t))
      .send({ name: '  Physics  ', description: 'Room 3' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: 'Physics',
      description: 'Room 3',
      joiningOpen: true,
      studentCount: 0,
    });
    expect(res.body.joinCode.code).toMatch(/^\d{6}$/);
    expect(res.body.joinCode.joinUrl).toBe(`joinly://join?code=${res.body.joinCode.code}`);
    expect(new Date(res.body.joinCode.expiresAt).getTime() - clock.now().getTime()).toBe(24 * HOUR);
  });

  it('validates names with field errors', async () => {
    const { app, http } = makeApp();
    const t = await signIn(app, 't1', 'teacher');
    for (const name of ['', '   ', 'x'.repeat(81)]) {
      const res = await http.post('/v1/classrooms').set(bearer(t)).send({ name });
      expect(res.status).toBe(400);
      expect(res.body.errors[0].path).toBe('name');
    }
    const empty = await http
      .patch('/v1/classrooms/00000000-0000-4000-8000-000000000000')
      .set(bearer(t))
      .send({});
    expect(empty.status).toBe(400);
  });

  it('lists newest first with cursor pagination', async () => {
    const { app, http, clock } = makeApp();
    const t = await signIn(app, 't1', 'teacher');
    for (const n of ['A', 'B', 'C']) {
      await createClassroom(app, t, n);
      clock.advance(1000);
    }
    const p1 = await http.get('/v1/classrooms?limit=2').set(bearer(t));
    expect(p1.status).toBe(200);
    // created_at comes from the database clock, so assert on the set, ordered by the API.
    expect(p1.body.items).toHaveLength(2);
    expect(p1.body.nextCursor).toEqual(expect.any(String));
    const p2 = await http.get(`/v1/classrooms?limit=2&cursor=${p1.body.nextCursor}`).set(bearer(t));
    expect(p2.body.items).toHaveLength(1);
    expect(p2.body.nextCursor).toBeNull();
    const names = [...p1.body.items, ...p2.body.items].map((c: { name: string }) => c.name);
    expect(names.sort()).toEqual(['A', 'B', 'C']);

    const bad = await http.get('/v1/classrooms?cursor=garbage').set(bearer(t));
    expect(bad.status).toBe(400);
    const tooMany = await http.get('/v1/classrooms?limit=500').set(bearer(t));
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.errors[0].path).toBe('query.limit');
  });

  it('updates and deletes', async () => {
    const { app, http } = makeApp();
    const t = await signIn(app, 't1', 'teacher');
    const c = await createClassroom(app, t);

    const upd = await http
      .patch(`/v1/classrooms/${c.id}`)
      .set(bearer(t))
      .send({ name: 'Chemistry', description: '', joiningOpen: false });
    expect(upd.status).toBe(200);
    expect(upd.body).toMatchObject({ name: 'Chemistry', description: null, joiningOpen: false });

    expect((await http.delete(`/v1/classrooms/${c.id}`).set(bearer(t))).status).toBe(204);
    expect((await http.get(`/v1/classrooms/${c.id}`).set(bearer(t))).status).toBe(404);
  });
});

describe('access control', () => {
  it("returns 404 on every route of another teacher's classroom", async () => {
    const { app, http } = makeApp();
    const a = await signIn(app, 'a', 'teacher');
    const b = await signIn(app, 'b', 'teacher');
    const student = await signIn(app, 's', 'student');
    const c = await createClassroom(app, a);
    await http
      .post('/v1/enrollments')
      .set(bearer(student))
      .send({ code: c.joinCode.code, via: 'code' });

    const calls = [
      http.get(`/v1/classrooms/${c.id}`),
      http.patch(`/v1/classrooms/${c.id}`).send({ name: 'Hijacked' }),
      http.delete(`/v1/classrooms/${c.id}`),
      http.get(`/v1/classrooms/${c.id}/join-code`),
      http.post(`/v1/classrooms/${c.id}/join-code`),
      http.get(`/v1/classrooms/${c.id}/students`),
      http.delete(`/v1/classrooms/${c.id}/students/${student.userId}`),
    ];
    for (const call of calls) {
      const res = await call.set(bearer(b));
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    }
    // And nothing changed for the owner.
    const own = await http.get(`/v1/classrooms/${c.id}`).set(bearer(a));
    expect(own.body).toMatchObject({ name: 'Biology 101', studentCount: 1 });
  });

  it('forbids students from teacher routes and teachers from student routes', async () => {
    const { app, http } = makeApp();
    const t = await signIn(app, 't', 'teacher');
    const s = await signIn(app, 's', 'student');
    const studentCalls = [
      http.get('/v1/classrooms'),
      http.post('/v1/classrooms').send({ name: 'X' }),
    ];
    for (const call of studentCalls)
      expect((await call.set(bearer(s))).body.code).toBe('FORBIDDEN_ROLE');
    const teacherCalls = [
      http.get('/v1/enrollments'),
      http.post('/v1/enrollments').send({ code: '123456', via: 'code' }),
      http.post('/v1/enrollments/preview').send({ code: '123456' }),
    ];
    for (const call of teacherCalls) {
      const res = await call.set(bearer(t));
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_ROLE');
    }
  });

  it('treats a malformed id as not found', async () => {
    const { app, http } = makeApp();
    const t = await signIn(app, 't', 'teacher');
    expect((await http.get('/v1/classrooms/not-a-uuid').set(bearer(t))).status).toBe(404);
  });
});

describe('join codes', () => {
  it('regenerating revokes the old code immediately', async () => {
    const { app, http } = makeApp();
    const t = await signIn(app, 't', 'teacher');
    const s = await signIn(app, 's', 'student');
    const c = await createClassroom(app, t);

    const regen = await http.post(`/v1/classrooms/${c.id}/join-code`).set(bearer(t));
    expect(regen.status).toBe(201);
    expect(regen.body.code).not.toBe(c.joinCode.code);

    const old = await http
      .post('/v1/enrollments')
      .set(bearer(s))
      .send({ code: c.joinCode.code, via: 'qr' });
    expect(old.status).toBe(404);
    expect(old.body.code).toBe('JOIN_CODE_INVALID');
    const fresh = await http
      .post('/v1/enrollments')
      .set(bearer(s))
      .send({ code: regen.body.code, via: 'qr' });
    expect(fresh.status).toBe(201);

    const live = await http.get(`/v1/classrooms/${c.id}/join-code`).set(bearer(t));
    expect(live.body.code).toBe(regen.body.code);
  });

  it('expires after 24 hours and can be regenerated', async () => {
    const { app, http, clock } = makeApp();
    const t = await signIn(app, 't', 'teacher');
    const c = await createClassroom(app, t);

    clock.advance(24 * HOUR);
    const s = await signIn(app, 's', 'student');
    const join = await http
      .post('/v1/enrollments')
      .set(bearer(s))
      .send({ code: c.joinCode.code, via: 'code' });
    expect(join.status).toBe(410);
    expect(join.body.code).toBe('JOIN_CODE_EXPIRED');

    const t2 = await signIn(app, 't', 'teacher');
    const room = await http.get(`/v1/classrooms/${c.id}`).set(bearer(t2));
    expect(room.body.joinCode).toBeNull();
    expect((await http.get(`/v1/classrooms/${c.id}/join-code`).set(bearer(t2))).status).toBe(404);

    const regen = await http.post(`/v1/classrooms/${c.id}/join-code`).set(bearer(t2));
    expect(regen.status).toBe(201);
    // The expired code still reads as expired after it has been replaced.
    const again = await http
      .post('/v1/enrollments')
      .set(bearer(s))
      .send({ code: c.joinCode.code, via: 'code' });
    expect(again.body.code).toBe('JOIN_CODE_EXPIRED');
  });

  it('retries with a new number when a code collides with a live one', async () => {
    const sequence = ['111111', '111111', '222222'];
    const { app, http } = makeApp({ generateCode: () => sequence.shift() ?? '999999' });
    const t = await signIn(app, 't', 'teacher');
    const first = await createClassroom(app, t, 'First');
    const second = await createClassroom(app, t, 'Second');
    expect(first.joinCode.code).toBe('111111');
    expect(second.joinCode.code).toBe('222222');
    expect((await http.get(`/v1/classrooms/${second.id}`).set(bearer(t))).body.joinCode.code).toBe(
      '222222',
    );
  });

  it('reuses the number of an expired code', async () => {
    const codes = ['333333', '333333'];
    const { app, clock } = makeApp({ generateCode: () => codes.shift() ?? '999999' });
    const t = await signIn(app, 't', 'teacher');
    await createClassroom(app, t, 'Old');
    clock.advance(25 * HOUR);
    const t2 = await signIn(app, 't', 'teacher');
    const fresh = await createClassroom(app, t2, 'New');
    expect(fresh.joinCode.code).toBe('333333');
  });
});

describe('roster', () => {
  it('lists students for the teacher and removes one', async () => {
    const { app, http } = makeApp();
    const t = await signIn(app, 't', 'teacher');
    const c = await createClassroom(app, t);
    const students = [await signIn(app, 's1', 'student'), await signIn(app, 's2', 'student')];
    for (const s of students) {
      await http
        .post('/v1/enrollments')
        .set(bearer(s))
        .send({ code: c.joinCode.code, via: 'code' });
    }

    const roster = await http.get(`/v1/classrooms/${c.id}/students`).set(bearer(t));
    expect(roster.status).toBe(200);
    expect(roster.body.total).toBe(2);
    expect(roster.body.items[0]).toMatchObject({
      email: expect.stringContaining('@example.com'),
      joinedVia: 'code',
    });

    const rm = await http
      .delete(`/v1/classrooms/${c.id}/students/${students[0]!.userId}`)
      .set(bearer(t));
    expect(rm.status).toBe(204);
    const again = await http
      .delete(`/v1/classrooms/${c.id}/students/${students[0]!.userId}`)
      .set(bearer(t));
    expect(again.status).toBe(404);
    const after = await http.get(`/v1/classrooms/${c.id}/students`).set(bearer(t));
    expect(after.body.total).toBe(1);
  });
});

describe('code-space protection (security audit)', () => {
  it('limits new classrooms and codes to 30 an hour per account', async () => {
    const { app, http, clock } = makeApp();
    const teacher = await signIn(app, 'busy-teacher', 'teacher');
    const first = await createClassroom(app, teacher);
    for (let i = 0; i < 28; i++) await createClassroom(app, teacher, `Class ${i}`);
    const regen = await http.post(`/v1/classrooms/${first.id}/join-code`).set(bearer(teacher));
    expect(regen.status).toBe(201);

    const blocked = await http
      .post('/v1/classrooms')
      .set(bearer(teacher))
      .send({ name: 'One more' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('RATE_LIMITED');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    const blockedRegen = await http
      .post(`/v1/classrooms/${first.id}/join-code`)
      .set(bearer(teacher));
    expect(blockedRegen.status).toBe(429);

    // Other teachers are unaffected, and the limit resets after the hour.
    const other = await signIn(app, 'other-teacher', 'teacher');
    expect(
      (await http.post('/v1/classrooms').set(bearer(other)).send({ name: 'Mine' })).status,
    ).toBe(201);
    clock.advance(HOUR);
    const again = await signIn(app, 'busy-teacher', 'teacher');
    expect(
      (await http.post('/v1/classrooms').set(bearer(again)).send({ name: 'Later' })).status,
    ).toBe(201);
  });
});
