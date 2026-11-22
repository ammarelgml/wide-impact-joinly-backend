import { sql } from 'kysely';
import type { Executor } from '../../db/database.js';
import type { JoinMethod } from '../../db/schema.js';
import type { Cursor } from '../../lib/cursor.js';

export interface SummaryRecord {
  id: string;
  name: string;
  description: string | null;
  teacherName: string;
  teacherAvatarUrl: string | null;
  studentCount: number;
}

export interface EnrollmentRecord extends SummaryRecord {
  joinedAt: Date;
  joinedVia: JoinMethod;
}

export class EnrollmentRepository {
  constructor(private readonly db: Executor) {}

  /**
   * Idempotent under concurrency: of N simultaneous joins exactly one inserts,
   * the rest get undefined and read the existing row.
   */
  insertIfAbsent(row: { classroomId: string; studentId: string; via: JoinMethod; at: Date }) {
    return this.db
      .insertInto('enrollments')
      .values({
        classroom_id: row.classroomId,
        student_id: row.studentId,
        joined_via: row.via,
        joined_at: row.at,
      })
      .onConflict((oc) => oc.columns(['classroom_id', 'student_id']).doNothing())
      .returning(['joined_at', 'joined_via'])
      .executeTakeFirst();
  }

  find(classroomId: string, studentId: string) {
    return this.db
      .selectFrom('enrollments')
      .select(['joined_at', 'joined_via'])
      .where('classroom_id', '=', classroomId)
      .where('student_id', '=', studentId)
      .executeTakeFirst();
  }

  /** What a student may see about a classroom (D14). */
  summary(classroomId: string): Promise<SummaryRecord | undefined> {
    return this.summaryQuery().where('c.id', '=', classroomId).executeTakeFirst();
  }

  listForStudent(
    studentId: string,
    cursor: Cursor | undefined,
    limit: number,
  ): Promise<EnrollmentRecord[]> {
    let q = this.summaryQuery()
      .innerJoin('enrollments as mine', 'mine.classroom_id', 'c.id')
      .select(['mine.joined_at as joinedAt', 'mine.joined_via as joinedVia'])
      .where('mine.student_id', '=', studentId);
    if (cursor) {
      q = q.where(({ eb, refTuple, tuple }) =>
        eb(refTuple('mine.joined_at', 'mine.classroom_id'), '<', tuple(cursor.t, cursor.id)),
      );
    }
    return q
      .orderBy('mine.joined_at', 'desc')
      .orderBy('mine.classroom_id', 'desc')
      .limit(limit + 1)
      .execute();
  }

  async delete(classroomId: string, studentId: string): Promise<boolean> {
    const r = await this.db
      .deleteFrom('enrollments')
      .where('classroom_id', '=', classroomId)
      .where('student_id', '=', studentId)
      .executeTakeFirst();
    return r.numDeletedRows > 0n;
  }

  private summaryQuery() {
    return this.db
      .selectFrom('classrooms as c')
      .innerJoin('users as t', 't.id', 'c.teacher_id')
      .select((eb) => [
        'c.id',
        'c.name',
        'c.description',
        't.name as teacherName',
        't.avatar_url as teacherAvatarUrl',
        eb
          .selectFrom('enrollments as e')
          .select(sql<number>`count(*)::int`.as('n'))
          .whereRef('e.classroom_id', '=', 'c.id')
          .$asScalar()
          .$notNull()
          .as('studentCount'),
      ]);
  }
}
