import { z } from 'zod';
import { Id, Timestamp, page } from '../../http/common.schemas.js';
import { JoinedVia } from '../classrooms/schemas.js';

export const JoinCodeValue = z
  .string()
  .regex(/^\d{6}$/, 'A join code is exactly 6 digits.')
  .meta({ example: '482913' });

export const TeacherSummary = z
  .object({ name: z.string(), avatarUrl: z.url().nullable() })
  .meta({ id: 'TeacherSummary' });

/** What a student may see about a classroom (D14): no classmate names or emails. */
export const ClassroomSummary = z
  .object({
    id: Id,
    name: z.string(),
    description: z.string().nullable(),
    teacher: TeacherSummary,
    studentCount: z.int().nonnegative(),
  })
  .meta({ id: 'ClassroomSummary' });
export type ClassroomSummary = z.infer<typeof ClassroomSummary>;

export const PreviewBody = z.strictObject({ code: JoinCodeValue }).meta({ id: 'PreviewBody' });
export type PreviewBody = z.infer<typeof PreviewBody>;

export const ClassroomPreview = z
  .object({ classroom: ClassroomSummary, alreadyMember: z.boolean() })
  .meta({ id: 'ClassroomPreview' });
export type ClassroomPreview = z.infer<typeof ClassroomPreview>;

export const JoinBody = z
  .strictObject({ code: JoinCodeValue, via: JoinedVia })
  .meta({ id: 'JoinBody' });
export type JoinBody = z.infer<typeof JoinBody>;

export const Enrollment = z
  .object({
    classroom: ClassroomSummary,
    joinedAt: Timestamp,
    joinedVia: JoinedVia,
    alreadyMember: z.boolean().meta({
      description: 'True when the student was already enrolled; the join is idempotent.',
    }),
  })
  .meta({ id: 'Enrollment' });
export type Enrollment = z.infer<typeof Enrollment>;

export const EnrollmentPage = page(Enrollment).meta({ id: 'EnrollmentPage' });

export const EnrollmentParams = z.strictObject({ classroomId: Id });
