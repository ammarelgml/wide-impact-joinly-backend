import { sql } from 'kysely';
import type { Executor } from '../../db/database.js';
import type { Cursor } from '../../lib/cursor.js';

export interface ClassroomRecord {
  id: string;
  name: string;
  description: string | null;
  joiningOpen: boolean;
  createdAt: Date;
  updatedAt: Date;
  studentCount: number;
  code: string | null;
  codeCreatedAt: Date | null;
  codeExpiresAt: Date | null;
}

export interface RosterRecord {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  joinedAt: Date;
  joinedVia: 'qr' | 'code';
}

export class ClassroomRepository {
  constructor(private readonly db: Executor) {}

  insert(row: {
    teacherId: string;
    name: string;
    description: string | null;
  }): Promise<{ id: string }> {
    return this.db
      .insertInto('classrooms')
      .values({ teacher_id: row.teacherId, name: row.name, description: row.description })
      .returning('id')
      .executeTakeFirstOrThrow();
  }

  /** Ownership is part of the query: another teacher's classroom simply does not exist. */
  findOwned(id: string, teacherId: string): Promise<ClassroomRecord | undefined> {
    return this.baseQuery(teacherId).where('c.id', '=', id).executeTakeFirst();
  }

  /** Row lock on an owned classroom, to serialize code regeneration. */
  async lockOwned(id: string, teacherId: string): Promise<boolean> {
    const row = await this.db
      .selectFrom('classrooms')
      .select('id')
      .where('id', '=', id)
      .where('teacher_id', '=', teacherId)
      .forUpdate()
      .executeTakeFirst();
    return row !== undefined;
  }

  listOwned(
    teacherId: string,
    cursor: Cursor | undefined,
    limit: number,
  ): Promise<ClassroomRecord[]> {
    let q = this.baseQuery(teacherId);
    if (cursor) {
      q = q.where(({ eb, refTuple, tuple }) =>
        eb(refTuple('c.created_at', 'c.id'), '<', tuple(cursor.t, cursor.id)),
      );
    }
    return q
      .orderBy('c.created_at', 'desc')
      .orderBy('c.id', 'desc')
      .limit(limit + 1)
      .execute();
  }

  async update(
    id: string,
    teacherId: string,
    patch: { name?: string; description?: string | null; joiningOpen?: boolean },
  ): Promise<boolean> {
    const result = await this.db
      .updateTable('classrooms')
      .set({
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.description !== undefined && { description: patch.description }),
        ...(patch.joiningOpen !== undefined && { joining_open: patch.joiningOpen }),
      })
      .where('id', '=', id)
      .where('teacher_id', '=', teacherId)
      .executeTakeFirst();
    return result.numUpdatedRows > 0n;
  }

  async delete(id: string, teacherId: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom('classrooms')
      .where('id', '=', id)
      .where('teacher_id', '=', teacherId)
      .executeTakeFirst();
    return result.numDeletedRows > 0n;
  }

  roster(classroomId: string, cursor: Cursor | undefined, limit: number): Promise<RosterRecord[]> {
    let q = this.db
      .selectFrom('enrollments as e')
      .innerJoin('users as u', 'u.id', 'e.student_id')
      .select([
        'u.id',
        'u.name',
        'u.email',
        'u.avatar_url as avatarUrl',
        'e.joined_at as joinedAt',
        'e.joined_via as joinedVia',
      ])
      .where('e.classroom_id', '=', classroomId);
    if (cursor) {
      q = q.where(({ eb, refTuple, tuple }) =>
        eb(refTuple('e.joined_at', 'e.student_id'), '<', tuple(cursor.t, cursor.id)),
      );
    }
    return q
      .orderBy('e.joined_at', 'desc')
      .orderBy('e.student_id', 'desc')
      .limit(limit + 1)
      .execute();
  }

  async rosterTotal(classroomId: string): Promise<number> {
    const row = await this.db
      .selectFrom('enrollments')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('classroom_id', '=', classroomId)
      .executeTakeFirstOrThrow();
    return row.n;
  }

  async removeStudent(classroomId: string, studentId: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom('enrollments')
      .where('classroom_id', '=', classroomId)
      .where('student_id', '=', studentId)
      .executeTakeFirst();
    return result.numDeletedRows > 0n;
  }

  private baseQuery(teacherId: string) {
    return this.db
      .selectFrom('classrooms as c')
      .leftJoin('join_codes as jc', (join) =>
        join.onRef('jc.classroom_id', '=', 'c.id').on('jc.revoked_at', 'is', null),
      )
      .select((eb) => [
        'c.id',
        'c.name',
        'c.description',
        'c.joining_open as joiningOpen',
        'c.created_at as createdAt',
        'c.updated_at as updatedAt',
        eb
          .selectFrom('enrollments as e')
          .select(sql<number>`count(*)::int`.as('n'))
          .whereRef('e.classroom_id', '=', 'c.id')
          .$asScalar()
          .$notNull()
          .as('studentCount'),
        'jc.code',
        'jc.created_at as codeCreatedAt',
        'jc.expires_at as codeExpiresAt',
      ])
      .where('c.teacher_id', '=', teacherId);
  }
}
