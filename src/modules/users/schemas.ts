import { z } from 'zod';
import { Id, Timestamp } from '../../http/common.schemas.js';

export const Role = z.enum(['teacher', 'student']).meta({ id: 'Role' });
export type Role = z.infer<typeof Role>;

export const User = z
  .object({
    id: Id,
    email: z.email(),
    name: z.string(),
    avatarUrl: z.url().nullable(),
    role: Role,
    createdAt: Timestamp,
  })
  .meta({ id: 'User' });
export type User = z.infer<typeof User>;
