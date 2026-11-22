import type { User } from './schemas.js';
import type { UserRow } from '../../db/schema.js';

export const toUserDto = (u: UserRow): User => ({
  id: u.id,
  email: u.email,
  name: u.name,
  avatarUrl: u.avatar_url,
  role: u.role,
  createdAt: u.created_at.toISOString(),
});
