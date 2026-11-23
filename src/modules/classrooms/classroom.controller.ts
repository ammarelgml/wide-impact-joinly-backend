import { Router } from 'express';
import { classroomsEndpoints } from './endpoints.js';
import { type RouteDeps, created, mount, noContent, ok } from '../../http/route.js';
import { enforceLimit } from '../../http/middleware/rate-limit.js';
import type { RateLimiter } from '../../lib/rate-limiter.js';
import type { ClassroomService } from './classroom.service.js';

export function classroomController(
  deps: RouteDeps & { classrooms: ClassroomService; writeLimiter: RateLimiter },
): Router {
  const router = Router();
  const svc = deps.classrooms;
  // Each create or regenerate claims a number in the code space all teachers share,
  // so one account cannot fill it. Keyed by account and address.
  const limitWrites = (userId: string, ip: string | undefined) =>
    enforceLimit(
      deps.writeLimiter,
      `classroom-write:${userId}:${ip}`,
      'Too many new classrooms or codes. Wait and try again.',
    );

  mount(router, classroomsEndpoints.listClassrooms, deps, async ({ user, query }) =>
    ok(await svc.list(user.id, query.cursor, query.limit)),
  );

  mount(router, classroomsEndpoints.createClassroom, deps, async ({ user, body, req }) => {
    limitWrites(user.id, req.ip);
    return created(await svc.create(user.id, body));
  });

  mount(router, classroomsEndpoints.getClassroom, deps, async ({ user, params }) =>
    ok(await svc.get(user.id, params.id)),
  );

  mount(router, classroomsEndpoints.updateClassroom, deps, async ({ user, params, body }) =>
    ok(await svc.update(user.id, params.id, body)),
  );

  mount(router, classroomsEndpoints.deleteClassroom, deps, async ({ user, params }) => {
    await svc.delete(user.id, params.id);
    return noContent();
  });

  mount(router, classroomsEndpoints.getJoinCode, deps, async ({ user, params }) =>
    ok(await svc.getJoinCode(user.id, params.id)),
  );

  mount(router, classroomsEndpoints.regenerateJoinCode, deps, async ({ user, params, req }) => {
    limitWrites(user.id, req.ip);
    return created(await svc.regenerateJoinCode(user.id, params.id));
  });

  mount(router, classroomsEndpoints.listStudents, deps, async ({ user, params, query }) =>
    ok(await svc.listStudents(user.id, params.id, query.cursor, query.limit)),
  );

  mount(router, classroomsEndpoints.removeStudent, deps, async ({ user, params }) => {
    await svc.removeStudent(user.id, params.id, params.studentId);
    return noContent();
  });

  return router;
}
