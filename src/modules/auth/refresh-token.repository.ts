import type { Executor } from '../../db/database.js';
import type { RefreshTokenRow } from '../../db/schema.js';

export class RefreshTokenRepository {
  constructor(private readonly db: Executor) {}

  insert(row: {
    userId: string;
    familyId: string;
    tokenHash: Buffer;
    createdAt: Date;
    expiresAt: Date;
  }): Promise<{ id: string }> {
    return this.db
      .insertInto('refresh_tokens')
      .values({
        user_id: row.userId,
        family_id: row.familyId,
        token_hash: row.tokenHash,
        created_at: row.createdAt,
        expires_at: row.expiresAt,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
  }

  /**
   * Deletes refresh tokens past their expiry, for one user or for everyone.
   * An expired token can never be exchanged, so nothing depends on its row.
   */
  async deleteExpired(now: Date, userId?: string): Promise<number> {
    let q = this.db.deleteFrom('refresh_tokens').where('expires_at', '<=', now);
    if (userId) q = q.where('user_id', '=', userId);
    const res = await q.executeTakeFirst();
    return Number(res.numDeletedRows);
  }

  /** Locks the row so two concurrent refreshes of one token serialize. */
  findByHashForUpdate(tokenHash: Buffer): Promise<RefreshTokenRow | undefined> {
    return this.db
      .selectFrom('refresh_tokens')
      .selectAll()
      .where('token_hash', '=', tokenHash)
      .forUpdate()
      .executeTakeFirst();
  }

  findByHash(tokenHash: Buffer): Promise<RefreshTokenRow | undefined> {
    return this.db
      .selectFrom('refresh_tokens')
      .selectAll()
      .where('token_hash', '=', tokenHash)
      .executeTakeFirst();
  }

  async markRotated(id: string, replacedBy: string, at: Date): Promise<void> {
    await this.db
      .updateTable('refresh_tokens')
      .set({ revoked_at: at, replaced_by: replacedBy })
      .where('id', '=', id)
      .execute();
  }

  async revokeFamily(familyId: string, at: Date): Promise<void> {
    await this.db
      .updateTable('refresh_tokens')
      .set({ revoked_at: at })
      .where('family_id', '=', familyId)
      .where('revoked_at', 'is', null)
      .execute();
  }
}
