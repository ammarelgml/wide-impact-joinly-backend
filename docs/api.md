# Joinly API reference

> Generated from the endpoint definitions in `src/modules/*/endpoints.ts` by `pnpm docs:api`.
> The live, interactive version is served by the API at **`/docs`** (Swagger UI) and the raw
> OpenAPI 3.1 document at **`/openapi.json`**.

## Conventions

- Base path `/v1`, JSON only (`Content-Type: application/json`), bodies up to 10 kB.
- **Authentication.** Every endpoint except `/v1/auth/*` (other than logout) and the health checks needs
  `Authorization: Bearer <accessToken>`. Access tokens live 15 minutes. On `401 TOKEN_EXPIRED`, call
  `POST /v1/auth/refresh` once with the refresh token, store the new pair, and retry the request.
- **Roles.** A user is a `teacher` or a `student`, chosen at first sign-in. A wrong-role call gets
  `403 FORBIDDEN_ROLE`. A teacher calling another teacher's classroom gets `404 NOT_FOUND`.
- **Pagination.** List endpoints take `?limit` (1 to 100, default 20) and `?cursor`, and return
  `{ items, nextCursor }`. Pass `nextCursor` back as `cursor`; it is `null` on the last page.
- **Timestamps** are ISO 8601 strings in UTC.
- **Join codes** travel in request bodies, never in URLs, so they do not appear in access logs.
- **Request ids.** Every response has an `X-Request-Id` header; send your own to correlate.

## Errors

Every error is [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) problem details with
`Content-Type: application/problem+json` and a stable `code` to switch on:

```json
{
  "type": "https://joinly.app/problems/join-code-expired",
  "title": "Join code expired",
  "status": 410,
  "code": "JOIN_CODE_EXPIRED",
  "detail": "This code has expired. Ask your teacher for a new one.",
  "instance": "/v1/enrollments",
  "requestId": "9b2f1c4e-0d7a-4a43-8f55-2c1b8e6f0a12"
}
```

`VALIDATION_FAILED` adds `errors: [{ path, message }]`, one per field. `RATE_LIMITED` adds
`retryAfterSeconds` and a `Retry-After` header.

| Status | Code                    | Meaning                                                                                    |
| ------ | ----------------------- | ------------------------------------------------------------------------------------------ |
| 400    | `VALIDATION_FAILED`     | Body, query or JSON is invalid; see `errors[]`. Unknown fields are rejected.               |
| 401    | `UNAUTHENTICATED`       | No bearer token, or it is malformed or forged.                                             |
| 401    | `TOKEN_EXPIRED`         | Access token expired. Refresh and retry.                                                   |
| 401    | `GOOGLE_TOKEN_INVALID`  | Google ID token failed verification (signature, audience, issuer, expiry, verified email). |
| 401    | `REFRESH_TOKEN_INVALID` | Refresh token unknown, expired, or reused (the session family is revoked). Sign in again.  |
| 403    | `FORBIDDEN_ROLE`        | Signed in, but the wrong role for this endpoint.                                           |
| 404    | `NOT_FOUND`             | Resource does not exist or is not yours.                                                   |
| 404    | `JOIN_CODE_INVALID`     | No live classroom uses this code. Counts toward the attempt limit.                         |
| 409    | `JOINING_CLOSED`        | The code is valid but the teacher closed joining.                                          |
| 410    | `JOIN_CODE_EXPIRED`     | The code existed but expired (24 hours).                                                   |
| 422    | `ROLE_REQUIRED`         | First sign-in: resend the same ID token with `role`.                                       |
| 413    | `PAYLOAD_TOO_LARGE`     | Body over 10 kB.                                                                           |
| 429    | `RATE_LIMITED`          | Too many attempts; wait `Retry-After` seconds.                                             |
| 500    | `INTERNAL`              | Unexpected error; logged with the request id, details never returned.                      |

## Endpoints

| Method | Path                                     | Access        | Summary                                               |
| ------ | ---------------------------------------- | ------------- | ----------------------------------------------------- |
| POST   | `/v1/auth/google`                        | public        | Sign in with a Google ID token                        |
| POST   | `/v1/auth/demo`                          | public        | Sign in as a seeded demo account (review builds only) |
| POST   | `/v1/auth/refresh`                       | public        | Rotate a refresh token                                |
| POST   | `/v1/auth/logout`                        | authenticated | Sign out this device                                  |
| GET    | `/v1/me`                                 | authenticated | Current user                                          |
| GET    | `/v1/classrooms`                         | teacher       | List the teacher's classrooms                         |
| POST   | `/v1/classrooms`                         | teacher       | Create a classroom                                    |
| GET    | `/v1/classrooms/:id`                     | teacher       | Get a classroom                                       |
| PATCH  | `/v1/classrooms/:id`                     | teacher       | Rename, describe, or open/close joining               |
| DELETE | `/v1/classrooms/:id`                     | teacher       | Delete a classroom                                    |
| GET    | `/v1/classrooms/:id/join-code`           | teacher       | Get the live join code                                |
| POST   | `/v1/classrooms/:id/join-code`           | teacher       | Regenerate the join code                              |
| GET    | `/v1/classrooms/:id/students`            | teacher       | List the roster                                       |
| DELETE | `/v1/classrooms/:id/students/:studentId` | teacher       | Remove a student                                      |
| POST   | `/v1/enrollments/preview`                | student       | Look up a classroom by join code                      |
| POST   | `/v1/enrollments`                        | student       | Join a classroom                                      |
| GET    | `/v1/enrollments`                        | student       | List the student's classrooms                         |
| DELETE | `/v1/enrollments/:classroomId`           | student       | Leave a classroom                                     |
| GET    | `/healthz`                               | public        | Liveness                                              |
| GET    | `/readyz`                                | public        | Readiness (checks the database)                       |

### POST `/v1/auth/google`

Sign in with a Google ID token. Verifies the Google ID token server-side. Returning users are signed in. A new user must send `role`; without it the API answers 422 ROLE_REQUIRED and the app resends the same token with the chosen role.

**Auth:** Public

**Request body**

| Field     | Type                       | Required | Notes                                                            |
| --------- | -------------------------- | -------- | ---------------------------------------------------------------- |
| `idToken` | string                     | yes      | Google ID token from native sign-in. min 1 chars, max 4096 chars |
| `role`    | `"teacher"` \| `"student"` | no       | Required only on first sign-in. Ignored for existing users       |

```json
{
  "idToken": "<google-id-token>",
  "role": "teacher"
}
```

**Response 200** (example)

```json
{
  "accessToken": "<accessToken>",
  "accessTokenExpiresAt": "2026-11-22T19:30:00.000Z",
  "refreshToken": "<refreshToken>",
  "user": {
    "id": "3f1c2b9e-6a1d-4c5e-9b7a-2d4e8f0a1b2c",
    "email": "amira.hassan@example.com",
    "name": "Amira Hassan",
    "avatarUrl": "https://lh3.googleusercontent.com/a/photo",
    "role": "teacher",
    "createdAt": "2026-11-22T19:30:00.000Z"
  },
  "isNewUser": false
}
```

**Errors:** `GOOGLE_TOKEN_INVALID`, `ROLE_REQUIRED`, `RATE_LIMITED`, `VALIDATION_FAILED`

### POST `/v1/auth/demo`

Sign in as a seeded demo account (review builds only). Mounted only when DEMO_LOGIN_ENABLED=true; otherwise 404. Signs in as the seeded demo teacher or demo student.

**Auth:** Public

**Request body**

| Field     | Type                       | Required | Notes |
| --------- | -------------------------- | -------- | ----- |
| `account` | `"teacher"` \| `"student"` | yes      |       |

```json
{
  "account": "teacher"
}
```

**Response 200** (example)

```json
{
  "accessToken": "<accessToken>",
  "accessTokenExpiresAt": "2026-11-22T19:30:00.000Z",
  "refreshToken": "<refreshToken>",
  "user": {
    "id": "3f1c2b9e-6a1d-4c5e-9b7a-2d4e8f0a1b2c",
    "email": "amira.hassan@example.com",
    "name": "Amira Hassan",
    "avatarUrl": "https://lh3.googleusercontent.com/a/photo",
    "role": "teacher",
    "createdAt": "2026-11-22T19:30:00.000Z"
  },
  "isNewUser": false
}
```

**Errors:** `NOT_FOUND`, `RATE_LIMITED`, `VALIDATION_FAILED`

### POST `/v1/auth/refresh`

Rotate a refresh token. Revokes the presented refresh token and returns a new pair in the same family. Presenting an already-rotated token revokes the whole family (reuse detection).

**Auth:** Public

**Request body**

| Field          | Type   | Required | Notes                       |
| -------------- | ------ | -------- | --------------------------- |
| `refreshToken` | string | yes      | min 20 chars, max 200 chars |

```json
{
  "refreshToken": "<refreshToken>"
}
```

**Response 200** (example)

```json
{
  "accessToken": "<accessToken>",
  "accessTokenExpiresAt": "2026-11-22T19:30:00.000Z",
  "refreshToken": "<refreshToken>"
}
```

**Errors:** `REFRESH_TOKEN_INVALID`, `RATE_LIMITED`, `VALIDATION_FAILED`

### POST `/v1/auth/logout`

Sign out this device. Revokes the refresh token family. Idempotent.

**Auth:** Bearer token, any role

**Request body**

| Field          | Type   | Required | Notes                       |
| -------------- | ------ | -------- | --------------------------- |
| `refreshToken` | string | yes      | min 20 chars, max 200 chars |

```json
{
  "refreshToken": "<refreshToken>"
}
```

**Response 204:** no body.

**Errors:** `UNAUTHENTICATED`, `TOKEN_EXPIRED`, `VALIDATION_FAILED`

### GET `/v1/me`

Current user.

**Auth:** Bearer token, any role

**Response 200** (example)

```json
{
  "id": "3f1c2b9e-6a1d-4c5e-9b7a-2d4e8f0a1b2c",
  "email": "amira.hassan@example.com",
  "name": "Amira Hassan",
  "avatarUrl": "https://lh3.googleusercontent.com/a/photo",
  "role": "teacher",
  "createdAt": "2026-11-22T19:30:00.000Z"
}
```

**Errors:** `UNAUTHENTICATED`, `TOKEN_EXPIRED`

### GET `/v1/classrooms`

List the teacher's classrooms. Newest first, cursor paginated.

**Auth:** Bearer token, teacher (owner of the classroom)

**Query parameters**

| Field    | Type    | Required | Notes                                             |
| -------- | ------- | -------- | ------------------------------------------------- |
| `cursor` | string  | no       | Opaque cursor from a previous page. max 200 chars |
| `limit`  | integer | no       | >= 1, <= 100, default 20                          |

**Response 200** (example)

```json
{
  "items": [
    {
      "id": "3f1c2b9e-6a1d-4c5e-9b7a-2d4e8f0a1b2c",
      "name": "Grade 8 Science",
      "description": "Room 204, Sun/Tue/Thu",
      "joiningOpen": true,
      "studentCount": 3,
      "joinCode": {
        "code": "482913",
        "joinUrl": "joinly://join?code=482913",
        "expiresAt": "2026-11-22T19:30:00.000Z",
        "createdAt": "2026-11-22T19:30:00.000Z"
      },
      "createdAt": "2026-11-22T19:30:00.000Z",
      "updatedAt": "2026-11-22T19:30:00.000Z"
    }
  ],
  "nextCursor": "eyJ0IjoiMjAyNi0xMS0yM1Q..."
}
```

**Errors:** `UNAUTHENTICATED`, `TOKEN_EXPIRED`, `FORBIDDEN_ROLE`, `VALIDATION_FAILED`

### POST `/v1/classrooms`

Create a classroom. The classroom is created with its first join code. Limited to 30 new classrooms or codes per hour per account.

**Auth:** Bearer token, teacher (owner of the classroom)

**Request body**

| Field         | Type           | Required | Notes                     |
| ------------- | -------------- | -------- | ------------------------- |
| `name`        | string         | yes      | min 1 chars, max 80 chars |
| `description` | string \| null | no       |                           |

```json
{
  "name": "Grade 8 Science",
  "description": "Room 204, Sun/Tue/Thu"
}
```

**Response 201** (example)

```json
{
  "id": "3f1c2b9e-6a1d-4c5e-9b7a-2d4e8f0a1b2c",
  "name": "Grade 8 Science",
  "description": "Room 204, Sun/Tue/Thu",
  "joiningOpen": true,
  "studentCount": 3,
  "joinCode": {
    "code": "482913",
    "joinUrl": "joinly://join?code=482913",
    "expiresAt": "2026-11-22T19:30:00.000Z",
    "createdAt": "2026-11-22T19:30:00.000Z"
  },
  "createdAt": "2026-11-22T19:30:00.000Z",
  "updatedAt": "2026-11-22T19:30:00.000Z"
}
```

**Errors:** `RATE_LIMITED`, `UNAUTHENTICATED`, `TOKEN_EXPIRED`, `FORBIDDEN_ROLE`, `VALIDATION_FAILED`

### GET `/v1/classrooms/:id`

Get a classroom. Another teacher's classroom returns 404, not 403 (does not confirm it exists).

**Auth:** Bearer token, teacher (owner of the classroom)

**Path parameters**

| Field | Type   | Required | Notes                                                                                               |
| ----- | ------ | -------- | --------------------------------------------------------------------------------------------------- |
| `id`  | string | yes      | pattern `^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12} | 00000000-0000-0000-0000-000000000000 | ffffffff-ffff-ffff-ffff-ffffffffffff)$`, uuid |

**Response 200** (example)

```json
{
  "id": "3f1c2b9e-6a1d-4c5e-9b7a-2d4e8f0a1b2c",
  "name": "Grade 8 Science",
  "description": "Room 204, Sun/Tue/Thu",
  "joiningOpen": true,
  "studentCount": 3,
  "joinCode": {
    "code": "482913",
    "joinUrl": "joinly://join?code=482913",
    "expiresAt": "2026-11-22T19:30:00.000Z",
    "createdAt": "2026-11-22T19:30:00.000Z"
  },
  "createdAt": "2026-11-22T19:30:00.000Z",
  "updatedAt": "2026-11-22T19:30:00.000Z"
}
```

**Errors:** `NOT_FOUND`, `UNAUTHENTICATED`, `TOKEN_EXPIRED`, `FORBIDDEN_ROLE`

### PATCH `/v1/classrooms/:id`

Rename, describe, or open/close joining.

**Auth:** Bearer token, teacher (owner of the classroom)

**Path parameters**

| Field | Type   | Required | Notes                                                                                               |
| ----- | ------ | -------- | --------------------------------------------------------------------------------------------------- |
| `id`  | string | yes      | pattern `^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12} | 00000000-0000-0000-0000-000000000000 | ffffffff-ffff-ffff-ffff-ffffffffffff)$`, uuid |

**Request body**

| Field         | Type           | Required | Notes                     |
| ------------- | -------------- | -------- | ------------------------- |
| `name`        | string         | no       | min 1 chars, max 80 chars |
| `description` | string \| null | no       |                           |
| `joiningOpen` | boolean        | no       |                           |

```json
{
  "name": "Grade 8 Science",
  "description": "Room 204, Sun/Tue/Thu",
  "joiningOpen": true
}
```

**Response 200** (example)

```json
{
  "id": "3f1c2b9e-6a1d-4c5e-9b7a-2d4e8f0a1b2c",
  "name": "Grade 8 Science",
  "description": "Room 204, Sun/Tue/Thu",
  "joiningOpen": true,
  "studentCount": 3,
  "joinCode": {
    "code": "482913",
    "joinUrl": "joinly://join?code=482913",
    "expiresAt": "2026-11-22T19:30:00.000Z",
    "createdAt": "2026-11-22T19:30:00.000Z"
  },
  "createdAt": "2026-11-22T19:30:00.000Z",
  "updatedAt": "2026-11-22T19:30:00.000Z"
}
```

**Errors:** `NOT_FOUND`, `UNAUTHENTICATED`, `TOKEN_EXPIRED`, `FORBIDDEN_ROLE`, `VALIDATION_FAILED`

### DELETE `/v1/classrooms/:id`

Delete a classroom. Hard delete, cascading to join codes and enrollments.

**Auth:** Bearer token, teacher (owner of the classroom)

**Path parameters**

| Field | Type   | Required | Notes                                                                                               |
| ----- | ------ | -------- | --------------------------------------------------------------------------------------------------- |
| `id`  | string | yes      | pattern `^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12} | 00000000-0000-0000-0000-000000000000 | ffffffff-ffff-ffff-ffff-ffffffffffff)$`, uuid |

**Response 204:** no body.

**Errors:** `NOT_FOUND`, `UNAUTHENTICATED`, `TOKEN_EXPIRED`, `FORBIDDEN_ROLE`

### GET `/v1/classrooms/:id/join-code`

Get the live join code. Returns 404 NOT_FOUND if there is no live code (the last one expired).

**Auth:** Bearer token, teacher (owner of the classroom)

**Path parameters**

| Field | Type   | Required | Notes                                                                                               |
| ----- | ------ | -------- | --------------------------------------------------------------------------------------------------- |
| `id`  | string | yes      | pattern `^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12} | 00000000-0000-0000-0000-000000000000 | ffffffff-ffff-ffff-ffff-ffffffffffff)$`, uuid |

**Response 200** (example)

```json
{
  "code": "482913",
  "joinUrl": "joinly://join?code=482913",
  "expiresAt": "2026-11-22T19:30:00.000Z",
  "createdAt": "2026-11-22T19:30:00.000Z"
}
```

**Errors:** `NOT_FOUND`, `UNAUTHENTICATED`, `TOKEN_EXPIRED`, `FORBIDDEN_ROLE`

### POST `/v1/classrooms/:id/join-code`

Regenerate the join code. Revokes the current code (and its QR) immediately and issues a new one. Shares the 30 per hour limit with creating classrooms.

**Auth:** Bearer token, teacher (owner of the classroom)

**Path parameters**

| Field | Type   | Required | Notes                                                                                               |
| ----- | ------ | -------- | --------------------------------------------------------------------------------------------------- |
| `id`  | string | yes      | pattern `^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12} | 00000000-0000-0000-0000-000000000000 | ffffffff-ffff-ffff-ffff-ffffffffffff)$`, uuid |

**Response 201** (example)

```json
{
  "code": "482913",
  "joinUrl": "joinly://join?code=482913",
  "expiresAt": "2026-11-22T19:30:00.000Z",
  "createdAt": "2026-11-22T19:30:00.000Z"
}
```

**Errors:** `NOT_FOUND`, `RATE_LIMITED`, `UNAUTHENTICATED`, `TOKEN_EXPIRED`, `FORBIDDEN_ROLE`

### GET `/v1/classrooms/:id/students`

List the roster. Most recent joins first. Polled by the invite screen for the live roster.

**Auth:** Bearer token, teacher (owner of the classroom)

**Path parameters**

| Field | Type   | Required | Notes                                                                                               |
| ----- | ------ | -------- | --------------------------------------------------------------------------------------------------- |
| `id`  | string | yes      | pattern `^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12} | 00000000-0000-0000-0000-000000000000 | ffffffff-ffff-ffff-ffff-ffffffffffff)$`, uuid |

**Query parameters**

| Field    | Type    | Required | Notes                                             |
| -------- | ------- | -------- | ------------------------------------------------- |
| `cursor` | string  | no       | Opaque cursor from a previous page. max 200 chars |
| `limit`  | integer | no       | >= 1, <= 100, default 20                          |

**Response 200** (example)

```json
{
  "items": [
    {
      "id": "3f1c2b9e-6a1d-4c5e-9b7a-2d4e8f0a1b2c",
      "name": "Amira Hassan",
      "email": "amira.hassan@example.com",
      "avatarUrl": "https://lh3.googleusercontent.com/a/photo",
      "joinedAt": "2026-11-22T19:30:00.000Z",
      "joinedVia": "qr"
    }
  ],
  "nextCursor": "eyJ0IjoiMjAyNi0xMS0yM1Q...",
  "total": 3
}
```

**Errors:** `NOT_FOUND`, `UNAUTHENTICATED`, `TOKEN_EXPIRED`, `FORBIDDEN_ROLE`, `VALIDATION_FAILED`

### DELETE `/v1/classrooms/:id/students/:studentId`

Remove a student.

**Auth:** Bearer token, teacher (owner of the classroom)

**Path parameters**

| Field       | Type   | Required | Notes                                                                                               |
| ----------- | ------ | -------- | --------------------------------------------------------------------------------------------------- |
| `id`        | string | yes      | pattern `^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12} | 00000000-0000-0000-0000-000000000000 | ffffffff-ffff-ffff-ffff-ffffffffffff)$`, uuid |
| `studentId` | string | yes      | pattern `^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12} | 00000000-0000-0000-0000-000000000000 | ffffffff-ffff-ffff-ffff-ffffffffffff)$`, uuid |

**Response 204:** no body.

**Errors:** `NOT_FOUND`, `UNAUTHENTICATED`, `TOKEN_EXPIRED`, `FORBIDDEN_ROLE`

### POST `/v1/enrollments/preview`

Look up a classroom by join code. Shown to the student before they confirm. Failed lookups count toward the per-student attempt limit. The code travels in the body so it never lands in access logs.

**Auth:** Bearer token, student

**Request body**

| Field  | Type   | Required | Notes             |
| ------ | ------ | -------- | ----------------- |
| `code` | string | yes      | pattern `^\d{6}$` |

```json
{
  "code": "482913"
}
```

**Response 200** (example)

```json
{
  "classroom": {
    "id": "3f1c2b9e-6a1d-4c5e-9b7a-2d4e8f0a1b2c",
    "name": "Grade 8 Science",
    "description": "Room 204, Sun/Tue/Thu",
    "teacher": {
      "name": "Amira Hassan",
      "avatarUrl": "https://lh3.googleusercontent.com/a/photo"
    },
    "studentCount": 3
  },
  "alreadyMember": false
}
```

**Errors:** `JOIN_CODE_INVALID`, `JOIN_CODE_EXPIRED`, `JOINING_CLOSED`, `RATE_LIMITED`, `UNAUTHENTICATED`, `TOKEN_EXPIRED`, `FORBIDDEN_ROLE`, `VALIDATION_FAILED`

### POST `/v1/enrollments`

Join a classroom. Idempotent: 201 for a new enrollment, 200 with alreadyMember=true if already enrolled. Safe under concurrent requests.

**Auth:** Bearer token, student

**Request body**

| Field  | Type               | Required | Notes             |
| ------ | ------------------ | -------- | ----------------- |
| `code` | string             | yes      | pattern `^\d{6}$` |
| `via`  | `"qr"` \| `"code"` | yes      |                   |

```json
{
  "code": "482913",
  "via": "qr"
}
```

**Response 200** (example)

```json
{
  "classroom": {
    "id": "3f1c2b9e-6a1d-4c5e-9b7a-2d4e8f0a1b2c",
    "name": "Grade 8 Science",
    "description": "Room 204, Sun/Tue/Thu",
    "teacher": {
      "name": "Amira Hassan",
      "avatarUrl": "https://lh3.googleusercontent.com/a/photo"
    },
    "studentCount": 3
  },
  "joinedAt": "2026-11-22T19:30:00.000Z",
  "joinedVia": "qr",
  "alreadyMember": false
}
```

**Response 201** (example)

```json
{
  "classroom": {
    "id": "3f1c2b9e-6a1d-4c5e-9b7a-2d4e8f0a1b2c",
    "name": "Grade 8 Science",
    "description": "Room 204, Sun/Tue/Thu",
    "teacher": {
      "name": "Amira Hassan",
      "avatarUrl": "https://lh3.googleusercontent.com/a/photo"
    },
    "studentCount": 3
  },
  "joinedAt": "2026-11-22T19:30:00.000Z",
  "joinedVia": "qr",
  "alreadyMember": false
}
```

**Errors:** `JOIN_CODE_INVALID`, `JOIN_CODE_EXPIRED`, `JOINING_CLOSED`, `RATE_LIMITED`, `UNAUTHENTICATED`, `TOKEN_EXPIRED`, `FORBIDDEN_ROLE`, `VALIDATION_FAILED`

### GET `/v1/enrollments`

List the student's classrooms. Most recent joins first, cursor paginated.

**Auth:** Bearer token, student

**Query parameters**

| Field    | Type    | Required | Notes                                             |
| -------- | ------- | -------- | ------------------------------------------------- |
| `cursor` | string  | no       | Opaque cursor from a previous page. max 200 chars |
| `limit`  | integer | no       | >= 1, <= 100, default 20                          |

**Response 200** (example)

```json
{
  "items": [
    {
      "classroom": {
        "id": "3f1c2b9e-6a1d-4c5e-9b7a-2d4e8f0a1b2c",
        "name": "Grade 8 Science",
        "description": "Room 204, Sun/Tue/Thu",
        "teacher": {
          "name": "Amira Hassan",
          "avatarUrl": "https://lh3.googleusercontent.com/a/photo"
        },
        "studentCount": 3
      },
      "joinedAt": "2026-11-22T19:30:00.000Z",
      "joinedVia": "qr",
      "alreadyMember": false
    }
  ],
  "nextCursor": "eyJ0IjoiMjAyNi0xMS0yM1Q..."
}
```

**Errors:** `UNAUTHENTICATED`, `TOKEN_EXPIRED`, `FORBIDDEN_ROLE`, `VALIDATION_FAILED`

### DELETE `/v1/enrollments/:classroomId`

Leave a classroom.

**Auth:** Bearer token, student

**Path parameters**

| Field         | Type   | Required | Notes                                                                                               |
| ------------- | ------ | -------- | --------------------------------------------------------------------------------------------------- |
| `classroomId` | string | yes      | pattern `^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12} | 00000000-0000-0000-0000-000000000000 | ffffffff-ffff-ffff-ffff-ffffffffffff)$`, uuid |

**Response 204:** no body.

**Errors:** `NOT_FOUND`, `UNAUTHENTICATED`, `TOKEN_EXPIRED`, `FORBIDDEN_ROLE`
