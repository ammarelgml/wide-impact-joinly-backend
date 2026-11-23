import { z } from 'zod';
import { Id, Timestamp, page } from '../../http/common.schemas.js';

export const CLASSROOM_NAME_MAX = 80;
export const CLASSROOM_DESCRIPTION_MAX = 500;

export const ClassroomName = z.string().trim().min(1).max(CLASSROOM_NAME_MAX);
export const ClassroomDescription = z.string().trim().max(CLASSROOM_DESCRIPTION_MAX);

export const JoinCode = z
  .object({
    code: z
      .string()
      .regex(/^\d{6}$/)
      .meta({ example: '482913' }),
    joinUrl: z.string().meta({
      description:
        'Link encoded in the QR code. An https link to /join on this API when PUBLIC_URL is set (opens the app on Android, or a page with the code and a download link); otherwise joinly://join?code=.',
      example: 'https://wide-impact-joinly-backend-production.up.railway.app/join?code=482913',
    }),
    expiresAt: Timestamp,
    createdAt: Timestamp,
  })
  .meta({ id: 'JoinCode' });
export type JoinCode = z.infer<typeof JoinCode>;

export const Classroom = z
  .object({
    id: Id,
    name: z.string(),
    description: z.string().nullable(),
    joiningOpen: z.boolean(),
    studentCount: z.int().nonnegative(),
    joinCode: JoinCode.nullable().meta({
      description: 'The live code, or null if the last one expired. Regenerate to get a new one.',
    }),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .meta({ id: 'Classroom' });
export type Classroom = z.infer<typeof Classroom>;

export const ClassroomPage = page(Classroom).meta({ id: 'ClassroomPage' });

export const CreateClassroomBody = z
  .strictObject({
    name: ClassroomName,
    description: ClassroomDescription.nullable().optional(),
  })
  .meta({ id: 'CreateClassroomBody' });
export type CreateClassroomBody = z.infer<typeof CreateClassroomBody>;

export const UpdateClassroomBody = z
  .strictObject({
    name: ClassroomName.optional(),
    description: ClassroomDescription.nullable().optional(),
    joiningOpen: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'Provide at least one field to update.' })
  .meta({ id: 'UpdateClassroomBody' });
export type UpdateClassroomBody = z.infer<typeof UpdateClassroomBody>;

export const JoinedVia = z.enum(['qr', 'code']).meta({ id: 'JoinedVia' });
export type JoinedVia = z.infer<typeof JoinedVia>;

export const RosterStudent = z
  .object({
    id: Id,
    name: z.string(),
    email: z.email(),
    avatarUrl: z.url().nullable(),
    joinedAt: Timestamp,
    joinedVia: JoinedVia,
  })
  .meta({ id: 'RosterStudent' });
export type RosterStudent = z.infer<typeof RosterStudent>;

export const RosterPage = page(RosterStudent)
  .extend({ total: z.int().nonnegative() })
  .meta({ id: 'RosterPage' });
export type RosterPage = z.infer<typeof RosterPage>;

export const ClassroomIdParams = z.strictObject({ id: Id });
export const RosterStudentParams = z.strictObject({ id: Id, studentId: Id });
