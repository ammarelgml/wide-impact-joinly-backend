import { Router } from 'express';
import { authEndpoints } from './endpoints.js';
import { type RouteDeps, mount, noContent, ok } from '../../http/route.js';
import { limitByIp } from '../../http/middleware/rate-limit.js';
import type { RateLimiter } from '../../lib/rate-limiter.js';
import { UserRepository } from '../users/user.repository.js';
import { toUserDto } from '../users/user.mapper.js';
import { notFound } from '../../lib/app-error.js';
import type { Database } from '../../db/database.js';
import type { AuthService } from './auth.service.js';
import type { TokenService } from './token.service.js';

export function authController(
  deps: RouteDeps & {
    auth: AuthService;
    tokens: TokenService;
    db: Database;
    authLimiter: RateLimiter;
    demoLoginEnabled: boolean;
  },
): Router {
  const router = Router();
  const limited = [limitByIp(deps.authLimiter, 'auth')];

  mount(
    router,
    authEndpoints.googleSignIn,
    deps,
    async ({ body }) => ok(await deps.auth.signInWithGoogle(body.idToken, body.role)),
    limited,
  );

  // Not mounted at all unless enabled: the route then 404s like any unknown path.
  if (deps.demoLoginEnabled) {
    mount(
      router,
      authEndpoints.demoSignIn,
      deps,
      async ({ body }) => ok(await deps.auth.signInDemo(body.account)),
      limited,
    );
  }

  mount(
    router,
    authEndpoints.refresh,
    deps,
    async ({ body }) => ok((await deps.tokens.rotate(body.refreshToken)).pair),
    limited,
  );

  mount(router, authEndpoints.logout, deps, async ({ body, user }) => {
    await deps.tokens.revoke(body.refreshToken, user.id);
    return noContent();
  });

  mount(router, authEndpoints.me, deps, async ({ user }) => {
    const row = await new UserRepository(deps.db).findById(user.id);
    if (!row) throw notFound('User');
    return ok(toUserDto(row));
  });

  return router;
}
