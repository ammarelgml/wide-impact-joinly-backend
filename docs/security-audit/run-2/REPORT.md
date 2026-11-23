# Joinly backend security audit, run 2 (deeper pass)

## 1. Run facts

- **Method:** Cloudflare `security-audit` skill, **`standard` profile**, a scoped run. Its scope is the 4 units that run 1 (quick profile) deferred. Run 1's other 32 units are recorded as `out_of_scope`, because run 1 already reviewed them at `e8d61d6`.
- **Source ref:** `14a697f`, which already includes the run 1 fixes.
- **Budget:** 14 agent invocations, 12 used:
  - 4 hunters
  - a post-wave critic and a separate final-clean critic
  - 2 candidate verifiers
  - 2 fresh final-record verifiers
- **Execution:** source review plus bounded local tests against a disposable loopback PostgreSQL with dummy data. No deployed service, Google or registry was contacted.
- **Deviation from the skill:** no OS sandbox was available. Local checks ran in scratch copies of the repo with `env -i` and timeouts.
- **Early stop:** the final-clean critic proposed one more unit, a variant of finding 3.1 in which an anonymous demo-teacher session reaches the code space. It is recorded as `deferred` rather than given another wave. The fix for 3.1 covers that path too.

## 2. Posture summary

The deeper pass found no high or medium issue. It confirmed:

- Demo sessions cannot reach non-demo classrooms.
- The demo reseed touches only demo-owned data.
- Sign-in does no unbounded work before authentication.

It found one confirmed low issue and one lead that depends on the deployment. Both are now fixed in code.

## 3. Findings

| Verdict          | Title                                                                                    | Status                                                                        |
| ---------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Confirmed, low   | No per-teacher bound on claiming join codes from the shared 6-digit space                | Fixed in `f1749fb`                                                            |
| Needs validation | Refresh-token rows are never deleted. Growth is bounded only by the per-IP sign-in limit | Fixed in `f1749fb`. The size of the deployment volume is the owner's to check |

### 3.1 No per-teacher bound on the join-code space (low)

- **Problem:** creating a classroom or regenerating its code claims one of 1,000,000 numbers, and every teacher shares that space. Nothing limited how many numbers one account could hold.
- **Local result:** at 90% occupancy, a different teacher's create failed with 500 about 59% of the time (measured 117 of 200). Guessing odds against other classes also rise when one account holds most of the space.
- **Effort required:** reaching that occupancy takes about a million requests a day.
- **Fix:** create and regenerate are limited to 30 per hour per account and address, and return 429 `RATE_LIMITED` with `Retry-After`. That caps how many numbers one account can hold at once. Regression test: the 31st write in an hour gets 429, other teachers are unaffected, and the limit resets after the hour.

### 3.2 Refresh tokens never pruned (needs validation)

- **Problem:** every sign-in and every refresh adds a `refresh_tokens` row, and nothing deleted them. With demo login on, anonymous callers could grow the table at 30 rows per minute per IP address.
- **Fix:**
  - Each sign-in now deletes that user's expired tokens.
  - The release step deletes every expired token on each deploy.
  - Regression test: after 31 days, signing in again leaves a single row.
- **Left for the owner:**
  - Whether Railway accepts IPv6. Each IPv6 address gets its own rate-limit budget.
  - The Postgres volume quota.

## 4. Other changes from this run (no behaviour change)

- The published demo code `246810` is never issued to a real classroom. Without this, once the demo code expired, a real class could have drawn it, and anyone with the README's QR code could join that class.
- The seed no longer revokes `246810` on non-demo classrooms. It now fails loudly if the code is ever taken.

## 5. Hardening noted, not applied

- **Shared demo-student guess budget:** anyone using Student demo can use up the 5-wrong-guess budget for every Student demo session for 15 minutes. This stays inside the shared demo account, which is documented in the README. Real students are unaffected.
- **Shared per-IP sign-in bucket:** sign-in and refresh share one 30/min bucket per IP address. A whole class signing in at once from one school network could hit 429.
- **Code-space exhaustion error:** if the code space is ever exhausted, the error is still a generic 500 rather than a 503.

## 6. Coverage

- **In scope:** 5 units. 2 covered, 2 candidate (the records above), 1 deferred (the critic's variant unit).
- **Critics:** the post-wave critic was clean. The final-clean critic added the deferred variant.
- **Out of scope:** 32 units, covered by run 1 (`docs/security-audit/REPORT.md`).
- **Validators:** `validate-findings.cjs` PASS (2 records). `validate-coverage-ledger.cjs` PASS (37 units).
