# Joinly backend security audit, run 1

> A deeper follow-up pass (run 2, standard profile) on the areas this run deferred is in [run-2/REPORT.md](run-2/REPORT.md).

## 1. Run facts

- **Method:** Cloudflare `security-audit` skill (github.com/cloudflare/security-audit-skill), full-audit mode, **`quick` profile**. This is a partial pass by design: one hunter wave, one coverage critic, one independent verifier per candidate. It does not claim exhaustive coverage.
- **Target:** github.com/ammarelgml/wide-impact-joinly-backend at `e8d61d6`. Scope: `src`, `scripts`, `migrations`, `Dockerfile`, `railway.json`, `.github/workflows`, `package.json`, `pnpm-lock.yaml`, `.dockerignore`.
- **Out of scope:** the mobile repository, Railway and Google Cloud console configuration, and the live deployment.
- **Budget:** 12 agent invocations planned, 8 used (4 hunters, 1 critic, 3 verifiers).
- **Prior runs:** none. No earlier ledger existed, so nothing was carried forward.
- **Execution:** source review plus bounded local tests only. No deployed endpoint, Google or registry was contacted.
- **Deviation from the skill:**
  - **No sandbox.** No OS sandbox (bwrap) was available. Local checks ran in scratch copies of the repo with `env -i`, a 120 s timeout, and a disposable loopback PostgreSQL holding dummy data.
  - **Recon.** Reconnaissance was done by the parent (the target is about 1.4k lines).
  - **Prompts.** Prompts were assembled verbatim into per-agent files.
- **Deferred coverage:** the final critic proposed 4 units. The quick profile defers these with reason `quick_profile_final_critic` (see section 7).

## 2. Posture summary

The core boundaries hold:

- Google ID-token and access-token verification are correct.
- Refresh tokens are hashed and rotated, and reuse revokes the whole family.
- Teacher ownership is enforced on every classroom query, with role-typed database FKs behind it.
- Queries are parameterized throughout.
- No secrets are present in the repo or the image.
- CI has no privileged path.

Two low-severity issues were confirmed, and one deployment-dependent lead needs an owner check.

## 3. Confirmed findings

| Severity | Title                                                                    | Boundary                                  | Observed result                                                                 |
| -------- | ------------------------------------------------------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------- |
| Low      | Failed join-code limiter is check-then-act                               | Per-student brute-force budget (D7)       | 55 concurrent wrong guesses: 10-11 evaluated against a budget of 5              |
| Low      | Shared demo-teacher identity reaches real students who join demo classes | Anonymous caller vs real principal's data | Anonymous demo session read a real student's email (200) and removed them (204) |

## 4. Confirmed finding details

### 4.1 Failed join-code limiter is check-then-act (low)

- **Location:** `src/modules/enrollments/enrollment.service.ts` `resolveCode`.
  - It calls `failedAttempts.check()`, which only reads the counter.
  - It then awaits `findLatestByCode()`.
  - Only after that does it call `hit()`.
- **Principal:** any signed-in student.
- **Reproduction:** `Promise.all` of 55 `POST /v1/enrollments/preview` requests with different wrong codes and the same bearer token.
- **Result:** 10-11 requests were evaluated as `JOIN_CODE_INVALID` against a budget of 5. A sequential control evaluated exactly 5.
- **Impact:** about 2x faster code guessing per account observed. From source, the ceiling is about 12x per IP, capped by the 60/min IP limiter. A student who guesses a code only joins the class: they see the class summary, and the teacher can remove them and regenerate the code.
- **Fix applied** (commit `778825a`): join-code lookups are now serialized per student with a small in-memory `KeyedMutex` (`src/lib/keyed-mutex.ts`).
  - Check, lookup and hit now run atomically for each student.
  - The verifier proposed "reserve then refund" instead. I tried it, and it rate-limited legitimate concurrent joins, which changes behaviour, so I did not use it.
  - Regression tests:
    - A 30-request concurrent burst gets exactly 5 evaluated.
    - A code that resolves does not use up the budget.
    - The existing test where 10 concurrent joins create exactly one row still passes.

### 4.2 Shared demo identity reaches real students (low)

- **Location:** `src/modules/auth/auth.service.ts` `signInDemo` → `ClassroomService.roster` → `classroom.repository.ts` `roster`.
- **Principal:** an anonymous internet client, when `DEMO_LOGIN_ENABLED=true`.
- **Reproduction:**
  1. A real (fake-Google) student joins the seeded demo class "Grade 8 Science".
  2. A separate anonymous caller calls `POST /v1/auth/demo {account:"teacher"}`, then `GET /v1/classrooms/:id/students`, then `DELETE` on that student.
- **Result:** the roster call returned the real student's email (200), and the delete returned 204.
- **Conditions:**
  - The demo flag is on. The README documents it for the review deployment.
  - A real account joined a demo-teacher class.
  - The data lasts only until the next deploy, because the reseed wipes demo classes.
- **Impact:** the name, email and avatar of those real students are exposed, and anyone can remove them. Other teachers are unaffected.
- **Status:** owner decision: keep the behaviour (the brief asks for demo test credentials) and document it. The README Known limitations now states that demo accounts are shared, that real and demo accounts should not be mixed, and that `DEMO_LOGIN_ENABLED` must be off wherever real users are served.

## 5. Needs validation (no severity)

| Lead                                                                         | Trace                                            | Blocker                                                                                   | Local step (done)                                                                                                                            | Owner check                                  |
| ---------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Per-IP auth/join limits depend on `TRUST_PROXY` matching Railway's hop count | `config.ts:28` → `app.ts:65` → `rate-limit.ts:8` | Deployed `TRUST_PROXY` value and Railway edge X-Forwarded-For behaviour are not in source | Fixture showed trust 0 merges all clients into one bucket, trust 2 allows X-Forwarded-For spoofing, trust 1 gives correct per-client buckets | Confirm the Railway variable `TRUST_PROXY=1` |

Owner check done 2026-11-23: `TRUST_PROXY=1` is set on the Railway service, which matches Railway's single edge hop. Details: [NEEDS-VALIDATION.md](NEEDS-VALIDATION.md).

## 6. Hardening and positive patterns

**Applied (no behaviour change):**

- CI now runs with `permissions: contents: read` and `persist-credentials: false`. Before, the gitleaks container saw the checkout token.
- The pg pool now has `connectionTimeoutMillis` 10 s and `statement_timeout` 15 s, so a stalled database fails fast instead of queueing requests forever.

**Noted, not applied:** each of these would change behaviour or deployment, or matters only at larger scale.

**Tokens and sign-in**

- Access tokens stay valid for up to 15 minutes after logout. This is the documented stateless design.
- Google sign-in does not bind a nonce.

**Seeding**

- `release.ts` seeds without the `SEED_CONFIRM` guard that the CLI uses. Adding it would break the Railway deploy as configured.
- The seed revokes any live `246810` code held by another class.

**Docs, rate limits and networking**

- `/docs` is served without helmet headers. Swagger UI needs a custom CSP.
- `JOIN_CODE_EXPIRED` and `JOINING_CLOSED` do not count as failures. That is by design (D16).
- Per-IP limits are shared behind a school NAT.
- The limiters use fixed windows and live in memory, which is fine for a single instance.
- Postgres TLS uses `sslmode=require`, with no certificate verification.

**Supply chain**

- GitHub Actions and Docker images are pinned by tag, not by SHA or digest.

**Positive patterns**

- Endpoint-as-data `mount()` applies auth, role and validation uniformly.
- Strict zod objects reject unknown fields.
- Ownership is part of every query, with composite FKs behind it.
- Refresh tokens are stored hashed, rotated under row locks, and reuse revokes the family.
- Log redaction is in place, and the production error body is generic.
- X-Request-Id is validated before use.
- The image is multi-stage, runs as a non-root user, and has a tight `.dockerignore`.
- Installs use a frozen lockfile with integrity hashes.

## 7. Coverage

- **36 ledger units:** 26 covered, 6 candidate (linked to the 3 records above), 0 blocked, 4 deferred.
- **Deferred by the final critic** (`quick_profile_final_critic`):
  - Demo principals meeting real users' data, and the reseed lifecycle. Related to finding 4.2.
  - The shared demo-student failure budget: any one anonymous caller can lock all reviewers out of guessing for 15 minutes.
  - Classroom create and regenerate have no per-teacher quota, so the code space could be exhausted.
  - Pre-auth work on the auth routes, and `refresh_tokens` rows are never pruned.
- **Excluded companions:**
  - AI/LLM: none present.
  - Memory safety: no native code.
  - Client-side: static pages only.
  - Mobile/IPC: separate repository.
  - RPC/messaging: REST only.
- **Validators:** `validate-findings.cjs` PASS (3 records). `validate-coverage-ledger.cjs` PASS (36 units).
