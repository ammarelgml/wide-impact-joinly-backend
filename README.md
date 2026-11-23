# Joinly backend

REST API for **Joinly**, a mobile app where teachers sign in with Google, create classrooms, and
onboard students with a **QR code** or a **6-digit joining code**. This repository is the backend;
the Expo app lives in [wide-impact-joinly-mobile](https://github.com/ammarelgml/wide-impact-joinly-mobile).

[![CI](https://github.com/ammarelgml/wide-impact-joinly-backend/actions/workflows/ci.yml/badge.svg)](https://github.com/ammarelgml/wide-impact-joinly-backend/actions/workflows/ci.yml)

|                       |                                                                                              |
| --------------------- | -------------------------------------------------------------------------------------------- |
| Hosted API            | https://wide-impact-joinly-backend-production.up.railway.app                                 |
| Interactive API docs  | `<hosted API>/docs` (Swagger UI), raw OpenAPI 3.1 at `/openapi.json`                         |
| API reference         | [docs/api.md](docs/api.md)                                                                   |
| Development approach  | [docs/approach.md](docs/approach.md), decision log in [docs/decisions.md](docs/decisions.md) |
| AI usage disclosure   | [docs/ai-usage.md](docs/ai-usage.md)                                                         |
| Manual test checklist | [docs/testing-checklist.md](docs/testing-checklist.md)                                       |

## Overview

- **Teachers** sign in with Google, create, edit and delete classrooms, see the roster, remove
  students, show the classroom's QR code and 6-digit code, regenerate the code, and open or close joining.
- **Students** sign in with Google, join by scanning the QR code or typing the code (with a preview
  of the class before confirming), see their classrooms, and leave one.
- A join code is 6 random digits, one live code per classroom, valid for 24 hours. Regenerating
  revokes the old code and its QR immediately. The QR encodes `joinly://join?code=482913`, so a
  scanned QR and a typed code go through the same API call.

## Technologies

| Concern                   | Choice                                                                                         |
| ------------------------- | ---------------------------------------------------------------------------------------------- |
| Runtime, framework        | Node.js 22, Express 5, TypeScript (strict)                                                     |
| Database                  | PostgreSQL, accessed with [Kysely](https://kysely.dev) (typed SQL builder, no ORM)             |
| Migrations                | [node-pg-migrate](https://salsita.github.io/node-pg-migrate/) with plain SQL files             |
| Validation, API contract  | [zod](https://zod.dev) 4; the same schemas validate requests and generate the OpenAPI document |
| Auth                      | `google-auth-library` (Google ID token verification), `jose` (JWT access tokens)               |
| Logging, security headers | pino (+ pino-http, with redaction), helmet                                                     |
| API docs                  | OpenAPI 3.1 generated at runtime, Swagger UI at `/docs`                                        |
| Tests                     | Vitest + supertest against a real PostgreSQL                                                   |
| Delivery                  | Docker, docker-compose, GitHub Actions CI, Railway                                             |

## Project structure

```
migrations/                 Plain SQL migrations (schema, constraints, indexes)
scripts/
  seed.ts                   Demo data for reviewers (idempotent)
  generate-api-docs.ts      Renders docs/api.md from the endpoint definitions
src/
  server.ts                 Process entry: config, wiring, graceful shutdown
  app.ts                    Composition root: builds services and the Express app
  config/                   Environment parsing and validation (fails fast at boot)
  db/                       Kysely connection and table types
  http/                     Endpoint type, route mounting, problem details, OpenAPI, middleware
  lib/                      Clock, AppError, rate limiter, pagination cursor, logger
  modules/
    auth/                   Google sign-in, demo sign-in, access/refresh tokens
    users/                  User repository and schemas
    classrooms/             Teacher side: classrooms, join codes, roster
    enrollments/            Student side: preview, join, list, leave
      endpoints.ts          The module's endpoints declared as data (method, path, role, schemas, errors)
      schemas.ts            zod request/response schemas
      *.controller.ts       HTTP layer: maps validated input to a service call
      *.service.ts          Business rules
      *.repository.ts       SQL, and only SQL
test/                       Integration and unit tests
```

Requests flow one way: **route → controller → service → repository → PostgreSQL**. Each
endpoint is declared once in `modules/*/endpoints.ts`; `mount()` derives its authentication,
role check and validation from that declaration, and the OpenAPI document and
[docs/api.md](docs/api.md) are generated from the same declarations.

## Setup

**Requirements:** Node.js 22+, pnpm 10 (`corepack enable`), PostgreSQL 14+ (or Docker).

### Option A: Docker (one command)

```bash
docker compose up --build
```

This starts PostgreSQL, runs the migrations, seeds the demo data, and serves the API on
http://localhost:3000 (docs at http://localhost:3000/docs) with demo sign-in enabled.

### Option B: local Node + PostgreSQL

```bash
pnpm install
cp .env.example .env          # then fill in JWT_ACCESS_SECRET and GOOGLE_WEB_CLIENT_ID

# Create the databases (any PostgreSQL 14+):
createuser -s joinly -P       # password: joinly (or change DATABASE_URL)
createdb -O joinly joinly
createdb -O joinly joinly_test

pnpm db:migrate               # apply migrations/
pnpm db:seed                  # demo accounts and classrooms
pnpm dev                      # http://localhost:3000, reloads on change
```

### Database configuration

- `DATABASE_URL` points at the database; add `?sslmode=require` for managed providers.
- Schema lives in [`migrations/`](migrations) as plain SQL. `pnpm db:migrate` applies pending
  migrations, `pnpm db:migrate:down` rolls back the last one, `pnpm db:migrate:create <name>` adds one.
- Five tables: `users`, `classrooms`, `join_codes` (full code history), `enrollments`,
  `refresh_tokens`. The database itself enforces the rules that matter:
  - only teachers own classrooms and only students enroll (role-typed composite foreign keys),
  - one enrollment per student per classroom (composite primary key, which makes joins idempotent),
  - one live code per classroom, and no two live codes share a number (partial unique indexes),
  - name and description lengths, 6-digit code format (check constraints).

### Environment variables

See [`.env.example`](.env.example). The server validates them at boot and lists every problem.

| Variable                   | Required | Default       | Purpose                                                                    |
| -------------------------- | -------- | ------------- | -------------------------------------------------------------------------- |
| `DATABASE_URL`             | yes      |               | PostgreSQL connection string                                               |
| `JWT_ACCESS_SECRET`        | yes      |               | HS256 key for access tokens, 32+ characters (`openssl rand -base64 48`)    |
| `GOOGLE_WEB_CLIENT_ID`     | yes      |               | Google OAuth Web client ID (the ID token audience); comma-separate several |
| `PORT`                     | no       | `3000`        | HTTP port                                                                  |
| `NODE_ENV`                 | no       | `development` | `development`, `test` or `production`                                      |
| `LOG_LEVEL`                | no       | `info`        | pino level                                                                 |
| `ACCESS_TOKEN_TTL_SECONDS` | no       | `900`         | Access token lifetime (15 min)                                             |
| `REFRESH_TOKEN_TTL_DAYS`   | no       | `30`          | Refresh token lifetime                                                     |
| `JOIN_CODE_TTL_HOURS`      | no       | `24`          | Join code lifetime                                                         |
| `DEMO_LOGIN_ENABLED`       | no       | `false`       | Enables `POST /v1/auth/demo` for reviewers                                 |
| `TRUST_PROXY`              | no       | `0`           | Reverse proxies in front of the API (Railway: `1`), for correct client IPs |
| `TEST_DATABASE_URL`        | tests    |               | Database the integration tests migrate and truncate                        |
| `SEED_DEMO_DATA`           | no       |               | `true` makes the release step (re)seed demo data on each start             |
| `SEED_CONFIRM`             | no       |               | Must be `yes` to run `db:seed:prod` by hand when `NODE_ENV=production`     |

## Running the tests

```bash
pnpm test         # 50 tests: integration tests against TEST_DATABASE_URL, plus unit tests
pnpm lint && pnpm typecheck
```

The integration tests rebuild the test database from the real migrations, then exercise the API
over HTTP with a fake Google verifier and a controllable clock (to test 24-hour code expiry and
token expiry without waiting). They cover every row of the security table below, including
cross-teacher access, wrong-role access, refresh token reuse, brute-force limits, and 10 concurrent
joins producing exactly one enrollment. CI runs lint, typecheck, tests, build, a check that
`docs/api.md` is current, and a secret scan on every push.

## Test accounts

Reviewers have two ways in:

1. **Your own Google account.** Sign in, choose Teacher or Student once, and use the app normally.
   Use two Google accounts (one per role) on two phones to test the full flow.
2. **Demo accounts**, no Google needed. With `DEMO_LOGIN_ENABLED=true` (on for the hosted review
   deployment), the app's sign-in screen offers **Teacher demo** and **Student demo**:

| Account      | Name             | Seeded data                                                                             |
| ------------ | ---------------- | --------------------------------------------------------------------------------------- |
| Teacher demo | Ms. Amira Hassan | "Grade 8 Science" (joining open, 3 students) and "Grade 9 Mathematics" (joining closed) |
| Student demo | Omar Khaled      | Enrolled in "Grade 8 Science"                                                           |

A third seeded classroom, **"Arabic Literature"**, belongs to another teacher and has the fixed
join code **`246810`** (valid 30 days), so the demo student can test joining without a second device.

API-only equivalent:

```bash
curl -X POST $API/v1/auth/demo -H 'Content-Type: application/json' -d '{"account":"student"}'
```

## Testing QR code and numeric code onboarding

The full walkthrough, with every screen, is in the
[mobile app README](https://github.com/ammarelgml/wide-impact-joinly-mobile#testing-qr-code-and-numeric-code-onboarding).
In short:

**Numeric code, one device**

1. Sign in as **Student demo**.
2. Tap **Join a class**, then **Enter code**, and type `246810`. It checks the code once the sixth digit is in.
3. The confirm screen shows "Arabic Literature" by Mr. Youssef Nabil. Tap **Join class**.
4. The class appears in My classrooms. Entering the code again shows "You're already in this class".

**QR code, two devices**

1. Phone A: sign in as a teacher (or **Teacher demo**), open a classroom, tap **Show QR code**.
2. Phone B: sign in as a student, tap **Join a class**, then **Scan QR code**, and point it at phone A
   (or scan with the phone's own camera app, which opens `joinly://join?code=…` in Joinly).
3. Tap **Join class** on phone B. Phone A's student counter updates within seconds.

**QR code, one device**: scan this QR (code `246810`) from another screen or a printout:

<img src="docs/assets/demo-join-qr.png" alt="Join QR for code 246810" width="200" />

**What the API does in each edge case**

| Try this                                                      | API response                          |
| ------------------------------------------------------------- | ------------------------------------- |
| Teacher taps **Regenerate**, student uses the old code or QR  | `404 JOIN_CODE_INVALID`               |
| Teacher turns **Joining open** off, student uses a valid code | `409 JOINING_CLOSED`                  |
| Six wrong codes within 15 minutes                             | `429 RATE_LIMITED` with `Retry-After` |
| A code older than 24 hours                                    | `410 JOIN_CODE_EXPIRED`               |
| Joining a class you're already in                             | `200` with `alreadyMember: true`      |

## Security

| Threat                                       | Control                                                                                              | Test                                                        |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Forged or replayed Google token              | Server-side verification of signature, audience, issuer, expiry and verified email                   | Forged token is rejected                                    |
| Stolen refresh token                         | Opaque tokens, SHA-256 hashed at rest, rotated on every use; reuse revokes the whole family          | Reusing a rotated token revokes the family                  |
| Teacher reads another teacher's class        | Ownership is part of every classroom query; 404, not 403                                             | Teacher B gets 404 on all 7 of teacher A's classroom routes |
| Student calls teacher routes, or the reverse | Role check per endpoint, plus role-typed foreign keys in the database                                | Wrong-role calls return 403; direct wrong-role inserts fail |
| Guessing join codes                          | 5 failed lookups per student per 15 min, 60 join requests per IP per min, 24-hour expiry, regenerate | 6th bad guess returns 429 with Retry-After                  |
| Duplicate or racing joins                    | Composite primary key and `INSERT … ON CONFLICT DO NOTHING`                                          | 10 parallel joins create exactly 1 row                      |
| Malformed or oversized input                 | Strict schemas (unknown fields rejected), 10 kB body limit, parameterised SQL                        | Invalid bodies return 400 with field errors                 |
| Secrets or tokens in logs                    | pino redaction of auth headers, tokens and codes                                                     | Redaction unit test                                         |
| Secrets in the repo                          | Only `.env.example` is committed; config validated at boot                                           | gitleaks in CI                                              |
| Demo sign-in abused                          | Route not mounted unless the flag is set; IP rate-limited; signs in only as seeded users             | Route returns 404 with the flag off                         |

## Deployment (Railway)

`railway.json` builds the Dockerfile and health-checks `/readyz`. The container's start command runs
the release step first (`dist/scripts/release.js`: migrations, then the demo seed if
`SEED_DEMO_DATA=true`) and then starts the server, so every deploy migrates before serving traffic.

1. New project, deploy from this GitHub repository. Add a PostgreSQL database to the project.
2. Set the service variables: `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `JWT_ACCESS_SECRET` (48 random
   bytes), `GOOGLE_WEB_CLIENT_ID`, `NODE_ENV=production`, `PORT=3000`, `TRUST_PROXY=1`, `SUPPORT_EMAIL`, and for the
   review deployment `DEMO_LOGIN_ENABLED=true` and `SEED_DEMO_DATA=true`.
3. Generate a public domain for the service (port 3000).

## Known limitations

- **Rate-limit counters are in memory**, which is correct for the single API instance deployed. More
  instances would need a shared store (Redis or a Postgres table); the limiter is behind an interface,
  so that is a one-file change.
- **Refresh rotation has no grace window.** If the network drops the response to a refresh, the app's
  retry presents a rotated token and the session is revoked, so the user signs in again. Strict by
  choice; a few-seconds grace window is the usual refinement.
- **One role per account**, chosen at first sign-in and not changeable in the app (an admin task).
- **Out of scope:** anything inside a classroom beyond the roster (posts, assignments, grades),
  co-teachers, push notifications, account deletion, and a web client.
- **The roster refresh is polling** (every few seconds on the invite screen), not WebSockets or SSE.
