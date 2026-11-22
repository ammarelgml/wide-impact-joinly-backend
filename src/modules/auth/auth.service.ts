import type { AuthSession } from './schemas.js';
import type { Role } from '../users/schemas.js';
import type { Database } from '../../db/database.js';
import { AppError } from '../../lib/app-error.js';
import { UserRepository } from '../users/user.repository.js';
import { toUserDto } from '../users/user.mapper.js';
import type { GoogleTokenVerifier } from './google-verifier.js';
import type { TokenService } from './token.service.js';

/** Seeded reviewer accounts (D15). Their google_sub can never collide with a real Google sub. */
export const DEMO_ACCOUNTS = {
  teacher: {
    googleSub: 'demo:teacher',
    email: 'demo.teacher@joinly.app',
    name: 'Ms. Amira Hassan',
  },
  student: { googleSub: 'demo:student', email: 'demo.student@joinly.app', name: 'Omar Khaled' },
} as const;

export class AuthService {
  constructor(
    private readonly db: Database,
    private readonly google: GoogleTokenVerifier,
    private readonly tokens: TokenService,
  ) {}

  /**
   * Google proves identity once; from then on the API runs on its own tokens.
   * New users must choose a role; the app learns this from 422 ROLE_REQUIRED.
   */
  async signInWithGoogle(idToken: string, role: Role | undefined): Promise<AuthSession> {
    const profile = await this.google.verify(idToken);
    const users = new UserRepository(this.db);

    const existing = await users.findByGoogleSub(profile.googleSub);
    if (existing) {
      const user = await users.updateProfile(existing.id, profile);
      return this.session(user, false);
    }
    if (!role) {
      throw new AppError('ROLE_REQUIRED', 'First sign-in: choose teacher or student and resend.');
    }
    const { user, created } = await users.createOrGet(profile, role);
    return this.session(user, created);
  }

  async signInDemo(account: keyof typeof DEMO_ACCOUNTS): Promise<AuthSession> {
    const user = await new UserRepository(this.db).findByGoogleSub(
      DEMO_ACCOUNTS[account].googleSub,
    );
    if (!user) throw new AppError('NOT_FOUND', 'Demo accounts are not seeded on this server.');
    return this.session(user, false);
  }

  private async session(
    user: Parameters<typeof toUserDto>[0],
    isNewUser: boolean,
  ): Promise<AuthSession> {
    const pair = await this.tokens.issueForNewSession({ id: user.id, role: user.role });
    return { ...pair, user: toUserDto(user), isNewUser };
  }
}
