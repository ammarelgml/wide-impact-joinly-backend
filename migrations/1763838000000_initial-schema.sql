-- Up Migration

-- Every rule that matters is enforced here, so an application bug cannot break it:
-- only teachers own classrooms, only students enroll, one enrollment per student
-- per classroom, one live code per classroom, and no two live codes collide.

CREATE TYPE user_role AS ENUM ('teacher', 'student');
CREATE TYPE join_method AS ENUM ('qr', 'code');
CREATE TYPE join_code_revoke_reason AS ENUM ('regenerated', 'expired');

CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TABLE users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  google_sub  text NOT NULL UNIQUE,          -- the identity; email can change
  email       text NOT NULL,
  name        text NOT NULL,
  avatar_url  text,
  role        user_role NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  -- Lets other tables reference "a user who is a teacher" with a foreign key.
  CONSTRAINT users_id_role_key UNIQUE (id, role)
);
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE classrooms (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id    uuid NOT NULL,
  teacher_role  user_role NOT NULL DEFAULT 'teacher' CHECK (teacher_role = 'teacher'),
  name          text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  description   text CHECK (char_length(description) <= 500),
  joining_open  boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT classrooms_teacher_fkey FOREIGN KEY (teacher_id, teacher_role)
    REFERENCES users (id, role) ON DELETE CASCADE
);
CREATE INDEX classrooms_teacher_created_idx ON classrooms (teacher_id, created_at DESC, id DESC);
CREATE TRIGGER classrooms_set_updated_at BEFORE UPDATE ON classrooms
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Full code history per classroom. A code is "live" while revoked_at IS NULL;
-- it is usable while live and not past expires_at.
CREATE TABLE join_codes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  classroom_id   uuid NOT NULL REFERENCES classrooms (id) ON DELETE CASCADE,
  code           char(6) NOT NULL CHECK (code ~ '^[0-9]{6}$'),
  created_at     timestamptz NOT NULL,
  expires_at     timestamptz NOT NULL,
  revoked_at     timestamptz,
  revoked_reason join_code_revoke_reason,
  CHECK (expires_at > created_at),
  CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL))
);
-- No two live codes share a number, so a code resolves to exactly one classroom.
CREATE UNIQUE INDEX join_codes_live_code_key ON join_codes (code) WHERE revoked_at IS NULL;
-- One live code per classroom.
CREATE UNIQUE INDEX join_codes_live_classroom_key ON join_codes (classroom_id) WHERE revoked_at IS NULL;
-- Lookup by code across history, to tell "expired" from "never existed".
CREATE INDEX join_codes_code_history_idx ON join_codes (code, created_at DESC);
-- Sweep of expired live codes, which frees their numbers.
CREATE INDEX join_codes_live_expiry_idx ON join_codes (expires_at) WHERE revoked_at IS NULL;

CREATE TABLE enrollments (
  classroom_id  uuid NOT NULL REFERENCES classrooms (id) ON DELETE CASCADE,
  student_id    uuid NOT NULL,
  student_role  user_role NOT NULL DEFAULT 'student' CHECK (student_role = 'student'),
  joined_via    join_method NOT NULL,
  joined_at     timestamptz NOT NULL DEFAULT now(),
  -- Makes joining idempotent, even under concurrent requests.
  PRIMARY KEY (classroom_id, student_id),
  CONSTRAINT enrollments_student_fkey FOREIGN KEY (student_id, student_role)
    REFERENCES users (id, role) ON DELETE CASCADE
);
CREATE INDEX enrollments_student_joined_idx ON enrollments (student_id, joined_at DESC, classroom_id DESC);
CREATE INDEX enrollments_classroom_joined_idx ON enrollments (classroom_id, joined_at DESC, student_id DESC);

-- Opaque rotating refresh tokens. Only a SHA-256 hash is stored.
CREATE TABLE refresh_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  family_id    uuid NOT NULL,
  token_hash   bytea NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL,
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  replaced_by  uuid REFERENCES refresh_tokens (id) ON DELETE SET NULL,
  CHECK (expires_at > created_at)
);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);

-- Down Migration

DROP TABLE refresh_tokens;
DROP TABLE enrollments;
DROP TABLE join_codes;
DROP TABLE classrooms;
DROP TABLE users;
DROP FUNCTION set_updated_at();
DROP TYPE join_code_revoke_reason;
DROP TYPE join_method;
DROP TYPE user_role;
