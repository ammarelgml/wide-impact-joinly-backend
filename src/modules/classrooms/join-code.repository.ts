import { sql } from 'kysely';
import type { Executor } from '../../db/database.js';
import type { JoinCodeRow } from '../../db/schema.js';

export interface CodeLookup {
  code: string;
  expiresAt: Date;
  revokedReason: 'regenerated' | 'expired' | null;
  classroomId: string;
  joiningOpen: boolean;
}

export class JoinCodeRepository {
  constructor(private readonly db: Executor) {}

  findLive(classroomId: string): Promise<JoinCodeRow | undefined> {
    return this.db
      .selectFrom('join_codes')
      .selectAll()
      .where('classroom_id', '=', classroomId)
      .where('revoked_at', 'is', null)
      .executeTakeFirst();
  }

  /** Inserts a live code, or returns undefined if the number is taken by another live code. */
  insertIfFree(row: { classroomId: string; code: string; createdAt: Date; expiresAt: Date }) {
    return this.db
      .insertInto('join_codes')
      .values({
        classroom_id: row.classroomId,
        code: row.code,
        created_at: row.createdAt,
        expires_at: row.expiresAt,
      })
      .onConflict((oc) => oc.doNothing())
      .returningAll()
      .executeTakeFirst();
  }

  async revokeLive(classroomId: string, at: Date): Promise<void> {
    await this.db
      .updateTable('join_codes')
      .set({
        revoked_at: at,
        // An expired code being replaced is recorded as expired, so a later
        // lookup still tells the student "expired" rather than "invalid".
        revoked_reason: sql`CASE WHEN expires_at <= ${at} THEN 'expired' ELSE 'regenerated' END::join_code_revoke_reason`,
      })
      .where('classroom_id', '=', classroomId)
      .where('revoked_at', 'is', null)
      .execute();
  }

  /** Revokes every expired live code, freeing those numbers for reuse. Uses a partial index. */
  async sweepExpired(at: Date): Promise<void> {
    await this.db
      .updateTable('join_codes')
      .set({ revoked_at: at, revoked_reason: 'expired' })
      .where('revoked_at', 'is', null)
      .where('expires_at', '<=', at)
      .execute();
  }

  /**
   * The most recent code with this number, live or not. History lets us tell
   * an expired code (410) from one that never existed or was regenerated (404).
   */
  findLatestByCode(code: string): Promise<CodeLookup | undefined> {
    return this.db
      .selectFrom('join_codes as jc')
      .innerJoin('classrooms as c', 'c.id', 'jc.classroom_id')
      .select([
        'jc.code',
        'jc.expires_at as expiresAt',
        'jc.revoked_reason as revokedReason',
        'c.id as classroomId',
        'c.joining_open as joiningOpen',
      ])
      .where('jc.code', '=', code)
      .orderBy('jc.revoked_at', (ob) => ob.desc().nullsFirst())
      .orderBy('jc.created_at', 'desc')
      .limit(1)
      .executeTakeFirst();
  }
}
