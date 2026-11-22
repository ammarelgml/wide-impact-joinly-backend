import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { SignJWT, errors as joseErrors, jwtVerify } from 'jose';
import type { Role } from '../users/schemas.js';
import type { TokenPair } from './schemas.js';
import type { Database } from '../../db/database.js';
import { AppError } from '../../lib/app-error.js';
import { type Clock, DAY_MS, addMs } from '../../lib/clock.js';
import { RefreshTokenRepository } from './refresh-token.repository.js';

export interface AuthUser {
  id: string;
  role: Role;
}

const ISSUER = 'joinly-api';
const AUDIENCE = 'joinly-app';

export interface TokenServiceOptions {
  accessTokenSecret: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlDays: number;
}

/**
 * Access tokens: short-lived HS256 JWTs, verified without a database hit.
 * Refresh tokens: 32 random bytes, stored only as a SHA-256 hash, rotated on
 * every use. Presenting a rotated token means it leaked, so the whole family
 * (every token descended from that sign-in) is revoked.
 */
export class TokenService {
  private readonly key: Uint8Array;

  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
    private readonly opts: TokenServiceOptions,
  ) {
    this.key = new TextEncoder().encode(opts.accessTokenSecret);
  }

  /** Starts a new refresh family (one per sign-in / device). */
  issueForNewSession(user: AuthUser): Promise<TokenPair> {
    return this.issuePair(user, randomUUID(), new RefreshTokenRepository(this.db)).then(
      (r) => r.pair,
    );
  }

  async rotate(rawRefreshToken: string): Promise<{ pair: TokenPair; userId: string }> {
    const hash = hashToken(rawRefreshToken);
    const now = this.clock.now();

    const outcome = await this.db.transaction().execute(async (trx) => {
      const repo = new RefreshTokenRepository(trx);
      const row = await repo.findByHashForUpdate(hash);
      if (!row) return { ok: false as const };
      if (row.revoked_at) {
        // Reuse of a rotated or revoked token: treat as theft.
        await repo.revokeFamily(row.family_id, now);
        return { ok: false as const, reuse: true };
      }
      if (row.expires_at <= now) return { ok: false as const };

      const user = await trx
        .selectFrom('users')
        .select(['id', 'role'])
        .where('id', '=', row.user_id)
        .executeTakeFirst();
      if (!user) return { ok: false as const };

      const { pair, id } = await this.issuePair(user, row.family_id, repo);
      await repo.markRotated(row.id, id, now);
      return { ok: true as const, pair, userId: user.id };
    });

    if (!outcome.ok)
      throw new AppError('REFRESH_TOKEN_INVALID', 'Refresh token is invalid. Sign in again.');
    return { pair: outcome.pair, userId: outcome.userId };
  }

  /** Revokes the family of the given token if it belongs to the user. Idempotent. */
  async revoke(rawRefreshToken: string, userId: string): Promise<void> {
    const repo = new RefreshTokenRepository(this.db);
    const row = await repo.findByHash(hashToken(rawRefreshToken));
    if (row && row.user_id === userId) await repo.revokeFamily(row.family_id, this.clock.now());
  }

  async verifyAccessToken(token: string): Promise<AuthUser> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
        currentDate: this.clock.now(),
      });
      const role = payload['role'];
      if (typeof payload.sub !== 'string' || (role !== 'teacher' && role !== 'student')) {
        throw new AppError('UNAUTHENTICATED', 'Malformed access token.');
      }
      return { id: payload.sub, role };
    } catch (err) {
      if (err instanceof joseErrors.JWTExpired) {
        throw new AppError('TOKEN_EXPIRED', 'Access token expired. Refresh and retry.');
      }
      if (err instanceof AppError) throw err;
      throw new AppError('UNAUTHENTICATED', 'Invalid access token.');
    }
  }

  private async issuePair(user: AuthUser, familyId: string, repo: RefreshTokenRepository) {
    const now = this.clock.now();
    const accessExpiresAt = addMs(now, this.opts.accessTokenTtlSeconds * 1000);
    const accessToken = await new SignJWT({ role: user.role })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(user.id)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(Math.floor(now.getTime() / 1000))
      .setExpirationTime(Math.floor(accessExpiresAt.getTime() / 1000))
      .sign(this.key);

    const refreshToken = randomBytes(32).toString('base64url');
    const { id } = await repo.insert({
      userId: user.id,
      familyId,
      tokenHash: hashToken(refreshToken),
      createdAt: now,
      expiresAt: addMs(now, this.opts.refreshTokenTtlDays * DAY_MS),
    });

    return {
      id,
      pair: { accessToken, accessTokenExpiresAt: accessExpiresAt.toISOString(), refreshToken },
    };
  }
}

export const hashToken = (raw: string) => createHash('sha256').update(raw, 'utf8').digest();
