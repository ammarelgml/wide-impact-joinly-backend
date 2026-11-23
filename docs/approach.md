# Development approach

This covers both parts of the project: the Expo app
([wide-impact-joinly-mobile](https://github.com/ammarelgml/wide-impact-joinly-mobile)) and the
API in this repository.

## How I approached the task

The features in the brief are small, so I spent the first part of the time deciding how things
should behave before writing code. Who signs in, what a join code looks like, how long it lasts,
what happens if a student taps Join twice, what a student is allowed to see about a class. I wrote
those answers down in [decisions.md](decisions.md) and built against them.

I built the backend first and deployed it, then built the app against the live API instead of
mocks. That way every error the app has to handle already existed and was tested.

On the app I got every teacher and student flow working first, including loading, empty, error and
offline states. Then I applied the visual design on top, and finally went through every flow on an
Android emulator and fixed what I found.

## Architecture

```
Expo app  --HTTPS/JSON-->  Express API  --SQL-->  PostgreSQL
```

### The app

The code is grouped by feature (`auth`, `classrooms`, `enrollments`, `join`). The files in
`src/app/` are only routes for Expo Router and point to screens inside those feature folders.
Shared UI components and the design tokens live in `src/ui/`.

Teachers and students have separate navigation stacks. The root layout restores the saved session
and only shows the stack that matches the user's role, so a student can't open teacher screens.

For state I kept two kinds of data apart:

- Anything that comes from the server (classrooms, roster, joined classes) is handled by TanStack
  Query. It caches, refetches on pull to refresh, and only polls while a live screen is open
  (the invite screen every 2 seconds, the classroom screen every 5).
- The session is the only real client state, and it sits in a small zustand store.
- Forms use react-hook-form with zod, using the same length limits as the API.

The API client is generated from the backend's OpenAPI document, so if I call an endpoint with the
wrong path or body it fails to compile. Every API error has a stable `code`, and the app decides
what to show based on that code, with one short message per code in `src/api/messages.ts`.

### The API

Each module (`auth`, `users`, `classrooms`, `enrollments`) is split into the same layers: a route
that checks the token, role and input, a controller, a service with the business rules, and a
repository with the SQL (Kysely).

Each endpoint is declared once in an `endpoints.ts` file with its method, path, role, request and
response schemas, and the errors it can return. The routes, the validation and the OpenAPI
document all come from those declarations, so the docs can't drift from what the server actually
does. Errors follow RFC 9457 (problem+json) with a stable `code`.

The Google token check and the clock are passed in, so the tests can fake Google and move time
forward to test the 24-hour code expiry without waiting.

## How the app, API and database talk to each other

1. The app signs in with Google on the device and gets a Google ID token.
2. It sends that token to `POST /v1/auth/google`. The API checks it with Google. A new user is
   asked to choose Teacher or Student, and the app sends the token again with that role.
3. The API answers with its own short access token (15 minutes, kept in memory) and a refresh
   token (30 days, saved in the Android Keystore). The Google token is not used after that.
4. Every request sends the access token. When it expires, the app refreshes it once and retries.
   Refresh tokens are single use, and reusing an old one signs that session out.
5. To join, the QR contains `https://<api>/join?code=NNNNNN`. If Joinly is installed on Android,
   the link opens the app directly (App Links). If not, it opens a small web page with the code
   and a download link. Scanning, opening the link and typing the code all end up calling the same
   two endpoints: preview the class, then join.
6. The API uses a PostgreSQL connection pool. Anything that writes more than one row (creating a
   class with its first code, regenerating a code, rotating a refresh token) runs in a transaction.

## Challenges and how I solved them

- **Ten taps on Join at the same time.** It must create one enrollment and all ten requests must
  succeed. A composite primary key and `INSERT ... ON CONFLICT DO NOTHING` handle it, and a test
  sends ten requests in parallel.
- **Two classes getting the same code.** A failed insert breaks a Postgres transaction, so a simple
  retry doesn't work. The insert skips conflicts and tries a new number if nothing was inserted.
- **Telling "expired" apart from "wrong".** I keep old codes with the reason they stopped working,
  so a student with an old code is told it expired instead of being told it's wrong.
- **Roles enforced by the database too.** Even if a route check had a bug, a student can't end up
  owning a class, because the foreign keys only accept a user with the right role.
- **Keeping two repos in sync.** There is no shared package, so the app's types are generated from
  the API's `/openapi.json`, and the app's CI fails if the live API's contract changes.
- **Two token refreshes at once.** Since refresh tokens are single use, two screens refreshing at
  the same moment would look like a stolen token and sign the user out. The app makes all
  requests wait for one shared refresh.
- **Scanning the QR without the app installed.** A `joinly://` link does nothing on a phone without
  the app, so I switched the QR to an https link with Android App Links. The same QR opens the app
  if it's installed and a download page if it isn't. Old `joinly://` codes still work.
- **Opening a join link while signed out.** The app keeps the code through sign-in and role choice,
  then takes the student straight to the join screen.
- **A crash after changing the phone's font size.** Android restarted the screen and the router
  never recovered, so the next tap closed the app. A small config plugin
  (`plugins/with-android-config-changes.js`) makes the app handle those changes without restarting.
- **Letting reviewers test without Google.** Google sign-in on Android depends on the signing key and
  the reviewer's account, so I added demo accounts that can be switched on with a flag.

## Assumptions and compromises

- Each account is either a teacher or a student, chosen once at first sign-in.
- The API runs as a single instance, so rate limits are kept in memory.
- Live updates use polling while a screen is open, not WebSockets.
- Only an Android APK is built. The code is cross-platform, but there was no time for an iOS build.
- Demo sign-in is turned on only for the review deployment.

## What I'd improve with more time

- Move rate limits to a shared store and add a short grace period to refresh token rotation.
- Replace polling with server-sent events for the live roster.
- Build for iOS, and add the dark theme and Arabic (right to left) from the design.
- Let the app queue changes made offline (reading cached data offline already works).
- Keep a log of who joined, who was removed and by whom.
- Add account deletion and data export.
- Support co-teachers and let an admin change a user's role.
