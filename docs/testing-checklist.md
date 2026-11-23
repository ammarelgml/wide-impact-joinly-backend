# Manual test checklist (API)

Automated: `pnpm test` (50 tests). This list is the manual pass against a deployed API, using
Swagger UI at `/docs` (click **Authorize** and paste an access token) or curl.

| #   | Step                                                                                              | Expected                                                  |
| --- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 1   | `GET /healthz`, `GET /readyz`                                                                     | `200 ok`, `200 ready`                                     |
| 2   | `POST /v1/auth/demo {"account":"teacher"}`                                                        | `200` with tokens and the demo teacher                    |
| 3   | `GET /v1/classrooms` as teacher                                                                   | Two seeded classrooms, each with a live code              |
| 4   | `POST /v1/classrooms {"name":"Test"}`                                                             | `201` with a 6-digit code and `https://<api>/join?code=…` |
| 5   | `POST /v1/auth/demo {"account":"student"}`, then `POST /v1/enrollments/preview {"code":"246810"}` | `200`, "Arabic Literature", `alreadyMember: false`        |
| 6   | `POST /v1/enrollments {"code":"246810","via":"code"}` twice                                       | `201`, then `200` with `alreadyMember: true`              |
| 7   | Teacher regenerates the code of step 4; student joins with the old code                           | `404 JOIN_CODE_INVALID`                                   |
| 8   | Teacher `PATCH {"joiningOpen":false}`; student joins with the new code                            | `409 JOINING_CLOSED`                                      |
| 9   | Student sends 6 wrong codes                                                                       | 6th returns `429` with `Retry-After`                      |
| 10  | Student calls `GET /v1/classrooms`                                                                | `403 FORBIDDEN_ROLE`                                      |
| 11  | `POST /v1/auth/refresh` with a refresh token, then again with the same one                        | `200`, then `401 REFRESH_TOKEN_INVALID`                   |
| 12  | Any request with a body over 10 kB                                                                | `413 PAYLOAD_TOO_LARGE`                                   |
