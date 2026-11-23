# AI tool usage

I used AI tools on both parts of the project, the mobile app and the API.

**Tools I used**

- Claude (Anthropic), through Claude Code, for planning, code, tests and documentation.
- Claude Design for the app's visual design.

**How I used them**

- **Planning.** I went through the brief with Claude and wrote down the open questions and my
  answers ([decisions.md](decisions.md)), plus the data model, sign-in design, API and screens. I
  reviewed every decision before any code was written and changed several of them, for example
  the 24-hour code expiry and keeping the app and backend as two separate projects, as the brief
  lists them.
- **Design.** I gave Claude Design a short brief based on the spec and used its output (colours,
  type, components and screen layouts) as the reference for the app's UI.
- **Code.** Claude wrote most of the first draft of the backend and the app, including migrations
  and tests, in small steps that I reviewed. I decided the structure and the trade-offs: the
  layers in the API, rules enforced by the database, the feature folders and how state is handled
  in the app.
- **Testing.** The API has integration tests against a real PostgreSQL, and the app has unit and
  component tests. I also went through the flows by hand on the live API, on an Android emulator
  and on a phone. When the AI got something wrong, the tests or my review caught it and it was
  fixed. I also had Claude do a security review of the backend
  ([security-audit/REPORT.md](security-audit/REPORT.md)).
- **Docs.** Written with Claude's help. The API reference is generated from the code.

I understand every file in both repositories and can explain why it is built the way it is and what
I would change for a bigger product (see [approach.md](approach.md)).
