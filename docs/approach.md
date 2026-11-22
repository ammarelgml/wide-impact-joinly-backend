# Development approach (backend)

## How I approached the task

1. **Specify before coding.** The features are small, so the review is about decisions. I wrote a
   short product and technical spec first and answered every question the brief leaves open
   ([decisions.md](decisions.md)): who signs in, what a code looks like, how long it lives, what
   happens on a double tap, what a student may see.
2. **Backend first, against a real database.** The mobile app is built against the deployed API,
   not mocks, so the API's error codes and edge cases are settled before any screen depends on them.
3. **Rules in the database, then in one service.** Constraints that must never break (role
   ownership, one enrollment, one live code, no code collisions) are SQL constraints. Business
   rules live only in services. Then the tests try to break both.
4. **Deliverables as code.** API docs, OpenAPI and the written reference are generated from the
   same definitions the server enforces; CI fails if the written reference is stale.

## Architecture

```
Expo app ──HTTPS/JSON──▶ Express API ──SQL (pg pool)──▶ PostgreSQL
  │                        │
  │ Google Sign-In          ├─ route: auth + role + zod validation (from endpoints.ts)
  │ (native) ─ID token─▶    ├─ controller: maps input to a service call
  │                        ├─ service: business rules, transactions
  │                        └─ repository: SQL only (Kysely)
  ◀── access JWT (15 min) + rotating refresh token (30 days)
```

- **Endpoints as data.** Each module declares its endpoints in `endpoints.ts`: method, path,
  role, zod schemas for params, query, body and each response, and the error codes it can return.
  `mount()` turns a declaration into a route (authentication, role check, validation), and the
  handler's return type is checked against the declared responses at compile time. Outside
  production every response is also validated against its schema at runtime, so a contract
  violation fails the tests instead of reaching the app.
- **One contract for the app.** The OpenAPI 3.1 document at `/openapi.json` is generated from those
  declarations. The mobile app generates its TypeScript client types from it, so the two
  repositories cannot silently disagree.
- **Errors.** Services throw `AppError(code)`; one middleware renders RFC 9457 problem details with
  a stable `code`, the request id, field errors for validation, and `Retry-After` for rate limits.
  Unknown errors are logged with the request id and returned as a generic `INTERNAL`.
- **Testability.** The Google verifier and the clock are injected interfaces. Tests run without
  Google and move time forward to test 24-hour code expiry and 15-minute token expiry.

## How the app, API and database communicate

1. The app signs in with Google natively and receives a Google **ID token** whose audience is our
   Web client ID.
2. It posts the ID token to `POST /v1/auth/google`. The API verifies it with Google's public keys
   and checks audience, issuer, expiry and verified email. A new user gets `422 ROLE_REQUIRED`;
   the app asks Teacher or Student and resends with `role`.
3. The API returns its own **access token** (JWT, 15 minutes, kept in memory on the device) and a
   **refresh token** (opaque, 30 days, stored in the Android Keystore via SecureStore). Google tokens
   never authorise API calls.
4. Every request carries `Authorization: Bearer <access token>`. On `401 TOKEN_EXPIRED` the app runs
   one shared refresh and retries. Refresh rotates the token; reusing an old one revokes the session.
5. The API talks to PostgreSQL through a connection pool. Multi-step writes (create a classroom with
   its first code, regenerate a code, rotate a refresh token) run in transactions, with row locks
   where two requests could race.

## Challenges and how I resolved them

- **Concurrent joins.** Ten simultaneous taps must produce one enrollment and ten successes. A
  composite primary key plus `INSERT … ON CONFLICT DO NOTHING RETURNING` gives exactly that without
  locks; the test fires ten parallel requests.
- **Code collisions inside a transaction.** A unique violation aborts a Postgres transaction, so a
  naive retry fails. The insert uses `ON CONFLICT DO NOTHING` and retries with a fresh number when no
  row comes back; expired codes are swept first so their numbers are reusable.
- **"Expired" vs. "invalid".** If expired codes were simply deleted, a student would be told the code
  is wrong when it is just old. Keeping code history, with a revoke reason, lets the API answer each
  case precisely without letting old codes count as valid.
- **Role safety beyond middleware.** A bug in a route guard should not let a student own a class.
  `users` has a unique `(id, role)` and the foreign keys reference it with a fixed role, so the
  database rejects it.
- **Two repositories, one contract.** Without a shared package, drift is the risk. Generating
  OpenAPI from the enforced schemas, validating responses in tests, and generating the app's types
  from `/openapi.json` makes drift a build failure instead of a runtime bug.

## Assumptions and compromises

- One role per account, chosen at first sign-in.
- Single API instance, so in-memory rate limiting is sufficient (behind an interface for Redis later).
- Roster updates by polling every few seconds while the invite screen is open, rather than WebSockets.
- Demo sign-in is enabled on the review deployment only, so reviewers are not blocked by Google's
  device checks.

## What I would improve with more time

- Shared rate-limit store and a grace window for refresh token rotation.
- Server-sent events for the live roster instead of polling.
- Audit log of membership changes (who joined, who was removed, by whom).
- Account deletion endpoint and data export.
- Co-teachers (a `classroom_teachers` table) and role changes by an admin.
- Load test of the join path and a Postgres-backed limiter for multi-instance deployments.
