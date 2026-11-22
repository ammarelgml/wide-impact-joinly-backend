import { Router } from 'express';
import { enrollmentsEndpoints } from './endpoints.js';
import { type RouteDeps, created, mount, noContent, ok } from '../../http/route.js';
import { limitByIp } from '../../http/middleware/rate-limit.js';
import type { RateLimiter } from '../../lib/rate-limiter.js';
import type { EnrollmentService } from './enrollment.service.js';

export function enrollmentController(
  deps: RouteDeps & { enrollments: EnrollmentService; joinIpLimiter: RateLimiter },
): Router {
  const router = Router();
  const svc = deps.enrollments;
  const limited = [limitByIp(deps.joinIpLimiter, 'join')];

  mount(
    router,
    enrollmentsEndpoints.previewEnrollment,
    deps,
    async ({ user, body }) => ok(await svc.preview(user.id, body.code)),
    limited,
  );

  mount(
    router,
    enrollmentsEndpoints.joinClassroom,
    deps,
    async ({ user, body }) => {
      const { enrollment, isNew } = await svc.join(user.id, body.code, body.via);
      return isNew ? created(enrollment) : ok(enrollment);
    },
    limited,
  );

  mount(router, enrollmentsEndpoints.listEnrollments, deps, async ({ user, query }) =>
    ok(await svc.list(user.id, query.cursor, query.limit)),
  );

  mount(router, enrollmentsEndpoints.leaveClassroom, deps, async ({ user, params }) => {
    await svc.leave(user.id, params.classroomId);
    return noContent();
  });

  return router;
}
