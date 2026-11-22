import type { Executor } from '../../db/database.js';
import type { UserRole, UserRow } from '../../db/schema.js';

export interface GoogleProfile {
  googleSub: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

export class UserRepository {
  constructor(private readonly db: Executor) {}

  findById(id: string): Promise<UserRow | undefined> {
    return this.db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst();
  }

  findByGoogleSub(googleSub: string): Promise<UserRow | undefined> {
    return this.db
      .selectFrom('users')
      .selectAll()
      .where('google_sub', '=', googleSub)
      .executeTakeFirst();
  }

  /** Refreshes name, email and photo from Google on every sign-in. */
  updateProfile(id: string, profile: GoogleProfile): Promise<UserRow> {
    return this.db
      .updateTable('users')
      .set({ email: profile.email, name: profile.name, avatar_url: profile.avatarUrl })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Creates the user, or returns the existing one if a concurrent first sign-in
   * won the race. The role of an existing user is never changed.
   */
  async createOrGet(
    profile: GoogleProfile,
    role: UserRole,
  ): Promise<{ user: UserRow; created: boolean }> {
    const inserted = await this.db
      .insertInto('users')
      .values({
        google_sub: profile.googleSub,
        email: profile.email,
        name: profile.name,
        avatar_url: profile.avatarUrl,
        role,
      })
      .onConflict((oc) => oc.column('google_sub').doNothing())
      .returningAll()
      .executeTakeFirst();
    if (inserted) return { user: inserted, created: true };
    const existing = await this.findByGoogleSub(profile.googleSub);
    if (!existing) throw new Error('User vanished between conflict and select');
    return { user: existing, created: false };
  }
}
