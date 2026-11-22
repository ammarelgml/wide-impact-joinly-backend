# AI tool usage disclosure

**Tools:** Claude (Anthropic), through Claude Code.

**How I used it**

- **Planning.** I used Claude to turn the brief into a written spec: the open questions and my
  decisions on them ([decisions.md](decisions.md)), the data model, the auth design, the API
  contract, and the test plan. I reviewed and approved each decision before any code was written,
  and changed several (for example the 24-hour code expiry and keeping backend and mobile as two
  separate projects, as the brief lists them).
- **Implementation.** Claude wrote most of the first draft of the code, migrations and tests from
  that spec, in small steps that I reviewed. I directed the structure (layering, endpoint
  declarations, database-enforced rules) and the trade-offs.
- **Verification.** Every behaviour in the spec has an integration test against a real PostgreSQL,
  and I ran the flows manually on the deployed API and on a phone. Where AI output was wrong or
  weaker than it should be, it was caught by those tests or in review and fixed.
- **Documentation.** Drafted with Claude; the API reference is generated from code.

**What I can explain and defend:** every file in this repository, including why each constraint,
index and error code exists, and what I would change at larger scale (see
[approach.md](approach.md)).
