import type { ColumnType, Generated, Insertable, Selectable } from 'kysely';

/**
 * Kysely table types, mirroring migrations/*.sql. Written by hand (the schema is
 * small); the integration tests run against the real migrated schema, so a
 * mismatch fails CI.
 */
type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type RequiredTimestamp = ColumnType<Date, Date | string, Date | string>;
type NullableTimestamp = ColumnType<
  Date | null,
  Date | string | null | undefined,
  Date | string | null
>;

export type UserRole = 'teacher' | 'student';
export type JoinMethod = 'qr' | 'code';

export interface UsersTable {
  id: Generated<string>;
  google_sub: string;
  email: string;
  name: string;
  avatar_url: string | null;
  role: UserRole;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface ClassroomsTable {
  id: Generated<string>;
  teacher_id: string;
  teacher_role: Generated<'teacher'>;
  name: string;
  description: string | null;
  joining_open: Generated<boolean>;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface JoinCodesTable {
  id: Generated<string>;
  classroom_id: string;
  code: string;
  created_at: RequiredTimestamp;
  expires_at: RequiredTimestamp;
  revoked_at: NullableTimestamp;
  revoked_reason: 'regenerated' | 'expired' | null;
}

export interface EnrollmentsTable {
  classroom_id: string;
  student_id: string;
  student_role: Generated<'student'>;
  joined_via: JoinMethod;
  joined_at: Timestamp;
}

export interface RefreshTokensTable {
  id: Generated<string>;
  user_id: string;
  family_id: string;
  token_hash: Buffer;
  created_at: RequiredTimestamp;
  expires_at: RequiredTimestamp;
  revoked_at: NullableTimestamp;
  replaced_by: string | null;
}

export interface DB {
  users: UsersTable;
  classrooms: ClassroomsTable;
  join_codes: JoinCodesTable;
  enrollments: EnrollmentsTable;
  refresh_tokens: RefreshTokensTable;
}

export type UserRow = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;
export type ClassroomRow = Selectable<ClassroomsTable>;
export type JoinCodeRow = Selectable<JoinCodesTable>;
export type RefreshTokenRow = Selectable<RefreshTokensTable>;
