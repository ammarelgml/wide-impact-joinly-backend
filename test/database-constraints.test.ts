import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import { db } from './helpers.js';

/** The rules hold even if application code is bypassed. */
describe('database constraints', () => {
  async function user(sub: string, role: 'teacher' | 'student') {
    return db
      .insertInto('users')
      .values({ google_sub: sub, email: `${sub}@x.io`, name: sub, role })
      .returning('id')
      .executeTakeFirstOrThrow();
  }

  it('a student cannot own a classroom', async () => {
    const s = await user('s', 'student');
    await expect(
      db.insertInto('classrooms').values({ teacher_id: s.id, name: 'X' }).execute(),
    ).rejects.toMatchObject({
      code: '23503',
    });
  });

  it('a teacher cannot be enrolled', async () => {
    const t = await user('t', 'teacher');
    const c = await db
      .insertInto('classrooms')
      .values({ teacher_id: t.id, name: 'X' })
      .returning('id')
      .executeTakeFirstOrThrow();
    await expect(
      db
        .insertInto('enrollments')
        .values({ classroom_id: c.id, student_id: t.id, joined_via: 'code' })
        .execute(),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('allows one live code per classroom and no duplicate live codes', async () => {
    const t = await user('t', 'teacher');
    const [a, b] = await Promise.all(
      ['A', 'B'].map((name) =>
        db
          .insertInto('classrooms')
          .values({ teacher_id: t.id, name })
          .returning('id')
          .executeTakeFirstOrThrow(),
      ),
    );
    const now = new Date();
    const later = new Date(now.getTime() + 1000);
    const code = (classroom_id: string, c: string) =>
      db
        .insertInto('join_codes')
        .values({ classroom_id, code: c, created_at: now, expires_at: later })
        .execute();

    await code(a!.id, '123456');
    await expect(code(a!.id, '654321')).rejects.toMatchObject({ code: '23505' }); // second live code
    await expect(code(b!.id, '123456')).rejects.toMatchObject({ code: '23505' }); // number collision
    await expect(code(b!.id, '12345')).rejects.toMatchObject({ code: '23514' }); // not 6 digits
  });

  it('enforces name length', async () => {
    const t = await user('t', 'teacher');
    await expect(
      db
        .insertInto('classrooms')
        .values({ teacher_id: t.id, name: 'x'.repeat(81) })
        .execute(),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(sql`select 1`.execute(db)).resolves.toBeDefined();
  });
});
