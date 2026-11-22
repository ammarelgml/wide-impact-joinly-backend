import { Router } from 'express';
import { classroomsEndpoints } from './endpoints.js';
import { type RouteDeps, created, mount, noContent, ok } from '../../http/route.js';
import type { ClassroomService } from './classroom.service.js';

export function classroomController(deps: RouteDeps & { classrooms: ClassroomService }): Router {
  const router = Router();
  const svc = deps.classrooms;

  mount(router, classroomsEndpoints.listClassrooms, deps, async ({ user, query }) =>
    ok(await svc.list(user.id, query.cursor, query.limit)),
  );

  mount(router, classroomsEndpoints.createClassroom, deps, async ({ user, body }) =>
    created(await svc.create(user.id, body)),
  );

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

  mount(router, classroomsEndpoints.regenerateJoinCode, deps, async ({ user, params }) =>
    created(await svc.regenerateJoinCode(user.id, params.id)),
  );

  mount(router, classroomsEndpoints.listStudents, deps, async ({ user, params, query }) =>
    ok(await svc.listStudents(user.id, params.id, query.cursor, query.limit)),
  );

  mount(router, classroomsEndpoints.removeStudent, deps, async ({ user, params }) => {
    await svc.removeStudent(user.id, params.id, params.studentId);
    return noContent();
  });

  return router;
}
