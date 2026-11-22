import type { Classroom, JoinCode, RosterStudent } from './schemas.js';
import { buildJoinUrl } from './join-link.js';
import type { JoinCodeRow } from '../../db/schema.js';
import type { ClassroomRecord, RosterRecord } from './classroom.repository.js';

export function toJoinCodeDto(
  c: Pick<JoinCodeRow, 'code' | 'created_at' | 'expires_at'>,
): JoinCode {
  return {
    code: c.code,
    joinUrl: buildJoinUrl(c.code),
    createdAt: c.created_at.toISOString(),
    expiresAt: c.expires_at.toISOString(),
  };
}

/** An expired code is reported as no code: the teacher sees "Generate a new code". */
export function toClassroomDto(r: ClassroomRecord, now: Date): Classroom {
  const live = r.code && r.codeCreatedAt && r.codeExpiresAt && r.codeExpiresAt > now;
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    joiningOpen: r.joiningOpen,
    studentCount: r.studentCount,
    joinCode: live
      ? toJoinCodeDto({ code: r.code!, created_at: r.codeCreatedAt!, expires_at: r.codeExpiresAt! })
      : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export const toRosterStudentDto = (r: RosterRecord): RosterStudent => ({
  id: r.id,
  name: r.name,
  email: r.email,
  avatarUrl: r.avatarUrl,
  joinedAt: r.joinedAt.toISOString(),
  joinedVia: r.joinedVia,
});
