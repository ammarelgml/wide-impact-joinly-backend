# AI tool usage disclosure

This covers both repositories: the mobile app
([wide-impact-joinly-mobile](https://github.com/ammarelgml/wide-impact-joinly-mobile)) and this API.

**Tools:** Claude (Anthropic), through Claude Code, for the spec, code, tests and documentation;
Claude Design for the app's visual design (design tokens, components and screens).

**How I used it**

- **Planning.** I used Claude to turn the brief into a written spec: the open questions and my
  decisions on them ([decisions.md](decisions.md)), the data model, the auth design, the API
  contract, the app's screens and flows, and the test plan. I reviewed and approved each decision
  before any code was written, and changed several (for example the 24-hour code expiry and keeping
  backend and mobile as two separate projects, as the brief lists them).
- **Design.** I gave Claude Design a design brief written from the spec and used its handoff
  (tokens, type, components and screen layouts) as the reference for the app's UI.
- **Implementation.** Claude wrote most of the first draft of the backend and the mobile app (code,
  migrations and tests) from that spec, in small steps that I reviewed. I directed the structure
  (layering, endpoint declarations, database-enforced rules, feature folders and state management in
  the app) and the trade-offs.
- **Verification.** Every API behaviour in the spec has an integration test against a real
  PostgreSQL, and the app has unit and component tests. I ran the flows manually on the deployed
  API, on an Android emulator and on a phone. Where AI output was wrong or weaker than it should be,
  it was caught by those tests or in review and fixed. I also used Claude to run a security review
  of the backend ([security-audit/REPORT.md](security-audit/REPORT.md)).
- **Documentation.** Drafted with Claude; the API reference is generated from code.

**What I can explain and defend:** every file in both repositories, including why each constraint,
index and error code exists, how the app manages state and sessions, and what I would change at
larger scale (see [approach.md](approach.md)).
