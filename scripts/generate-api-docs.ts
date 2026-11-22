/**
 * Renders docs/api.md from the same endpoint definitions the server mounts,
 * so the written API reference cannot drift from the code. CI checks it is current.
 *
 *   pnpm docs:api
 */
import { writeFileSync } from 'node:fs';
import { z } from 'zod';
import type { EndpointDef } from '../src/http/endpoint.js';
import { allEndpoints } from '../src/http/endpoints.js';
import { errorStatus, type ErrorCode } from '../src/http/problem.js';

type Json = Record<string, unknown>;
const toJson = (s: z.ZodType, io: 'input' | 'output'): Json => {
  const json = z.toJSONSchema(s, { io, unrepresentable: 'any' }) as Json;
  const defs = (json.$defs ?? {}) as Record<string, Json>;
  // Inline named schemas so each section reads on its own.
  const deref = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(deref);
    if (!node || typeof node !== 'object') return node;
    const n = node as Json;
    if (typeof n.$ref === 'string' && n.$ref.startsWith('#/$defs/')) {
      const rest = { ...n };
      delete rest.$ref;
      return deref({ ...defs[n.$ref.slice(8)], ...rest });
    }
    return Object.fromEntries(
      Object.entries(n)
        .filter(([k]) => k !== '$defs' && k !== '$schema')
        .map(([k, v]) => [k, deref(v)]),
    );
  };
  return deref(json) as Json;
};

/** A plausible example value for a JSON schema node. */
function sample(p: Json, key = '', parent = ''): unknown {
  if (p.example !== undefined) return p.example;
  if (p.default !== undefined) return p.default;
  if (p.enum) return (p.enum as unknown[])[0];
  if (p.anyOf) return sample((p.anyOf as Json[])[0]!, key, parent);
  const type = Array.isArray(p.type) ? p.type[0] : p.type;
  switch (type) {
    case 'object': {
      const props = (p.properties ?? {}) as Record<string, Json>;
      // Objects with an avatar are people (user, teacher, roster student); the rest are classrooms.
      const kind = 'avatarUrl' in props ? 'person' : 'thing';
      return Object.fromEntries(Object.entries(props).map(([k, v]) => [k, sample(v, k, kind)]));
    }
    case 'array':
      return [sample(p.items as Json, key, parent)];
    case 'integer':
    case 'number':
      return key.toLowerCase().includes('count') || key === 'total' ? 3 : 0;
    case 'boolean':
      return key === 'joiningOpen';
    case 'null':
      return null;
    case 'string':
      if (p.format === 'uuid') return '3f1c2b9e-6a1d-4c5e-9b7a-2d4e8f0a1b2c';
      if (p.format === 'date-time') return '2026-11-23T08:00:00.000Z';
      if (p.format === 'email') return 'amira.hassan@example.com';
      if (p.format === 'uri') return 'https://lh3.googleusercontent.com/a/photo';
      if (/token/i.test(key)) return key === 'idToken' ? '<google-id-token>' : `<${key}>`;
      if (key === 'nextCursor') return 'eyJ0IjoiMjAyNi0xMS0yM1Q...';
      if (key === 'name') return parent === 'person' ? 'Amira Hassan' : 'Grade 8 Science';
      if (key === 'description') return 'Room 204, Sun/Tue/Thu';
      return 'string';
    default:
      return null;
  }
}

function typeOf(p: Json): string {
  if (p.enum) return (p.enum as unknown[]).map((v) => `\`${JSON.stringify(v)}\``).join(' \\| ');
  if (p.anyOf) return (p.anyOf as Json[]).map(typeOf).join(' \\| ');
  if (Array.isArray(p.type)) return p.type.join(' \\| ');
  if (p.type === 'array') return `${typeOf(p.items as Json)}[]`;
  return String(p.type ?? (p.$ref ? 'object' : 'any'));
}

function constraints(p: Json): string {
  const c: string[] = [];
  if (p.minLength !== undefined) c.push(`min ${p.minLength} chars`);
  if (p.maxLength !== undefined) c.push(`max ${p.maxLength} chars`);
  if (p.minimum !== undefined) c.push(`>= ${p.minimum}`);
  if (p.maximum !== undefined) c.push(`<= ${p.maximum}`);
  if (p.pattern) c.push(`pattern \`${p.pattern}\``);
  if (p.format) c.push(String(p.format));
  if (p.default !== undefined) c.push(`default ${JSON.stringify(p.default)}`);
  return [String(p.description ?? '').replace(/\.$/, ''), c.join(', ')].filter(Boolean).join('. ');
}

function fieldTable(schema: z.ZodType, io: 'input' | 'output'): string {
  const json = toJson(schema, io);
  const props = (json.properties ?? {}) as Record<string, Json>;
  const required = new Set((json.required as string[]) ?? []);
  const rows = Object.entries(props).map(
    ([k, p]) =>
      `| \`${k}\` | ${typeOf(p)} | ${required.has(k) ? 'yes' : 'no'} | ${constraints(p)} |`,
  );
  return ['| Field | Type | Required | Notes |', '| --- | --- | --- | --- |', ...rows].join('\n');
}

function example(schema: z.ZodType, io: 'input' | 'output' = 'output'): string {
  return '```json\n' + JSON.stringify(sample(toJson(schema, io)), null, 2) + '\n```';
}

const ERROR_MEANINGS: Record<ErrorCode, string> = {
  VALIDATION_FAILED: 'Body, query or JSON is invalid; see `errors[]`. Unknown fields are rejected.',
  UNAUTHENTICATED: 'No bearer token, or it is malformed or forged.',
  TOKEN_EXPIRED: 'Access token expired. Refresh and retry.',
  GOOGLE_TOKEN_INVALID:
    'Google ID token failed verification (signature, audience, issuer, expiry, verified email).',
  REFRESH_TOKEN_INVALID:
    'Refresh token unknown, expired, or reused (the session family is revoked). Sign in again.',
  FORBIDDEN_ROLE: 'Signed in, but the wrong role for this endpoint.',
  NOT_FOUND: 'Resource does not exist or is not yours.',
  JOIN_CODE_INVALID: 'No live classroom uses this code. Counts toward the attempt limit.',
  JOINING_CLOSED: 'The code is valid but the teacher closed joining.',
  JOIN_CODE_EXPIRED: 'The code existed but expired (24 hours).',
  ROLE_REQUIRED: 'First sign-in: resend the same ID token with `role`.',
  PAYLOAD_TOO_LARGE: 'Body over 10 kB.',
  RATE_LIMITED: 'Too many attempts; wait `Retry-After` seconds.',
  INTERNAL: 'Unexpected error; logged with the request id, details never returned.',
};

const accessText: Record<EndpointDef['access'], string> = {
  public: 'Public',
  authenticated: 'Bearer token, any role',
  teacher: 'Bearer token, teacher (owner of the classroom)',
  student: 'Bearer token, student',
};

const out: string[] = [];
out.push(`# Joinly API reference

> Generated from the endpoint definitions in \`src/modules/*/endpoints.ts\` by \`pnpm docs:api\`.
> The live, interactive version is served by the API at **\`/docs\`** (Swagger UI) and the raw
> OpenAPI 3.1 document at **\`/openapi.json\`**.

## Conventions

- Base path \`/v1\`, JSON only (\`Content-Type: application/json\`), bodies up to 10 kB.
- **Authentication.** Every endpoint except \`/v1/auth/*\` (other than logout) and the health checks needs
  \`Authorization: Bearer <accessToken>\`. Access tokens live 15 minutes. On \`401 TOKEN_EXPIRED\`, call
  \`POST /v1/auth/refresh\` once with the refresh token, store the new pair, and retry the request.
- **Roles.** A user is a \`teacher\` or a \`student\`, chosen at first sign-in. A wrong-role call gets
  \`403 FORBIDDEN_ROLE\`. A teacher calling another teacher's classroom gets \`404 NOT_FOUND\`.
- **Pagination.** List endpoints take \`?limit\` (1 to 100, default 20) and \`?cursor\`, and return
  \`{ items, nextCursor }\`. Pass \`nextCursor\` back as \`cursor\`; it is \`null\` on the last page.
- **Timestamps** are ISO 8601 strings in UTC.
- **Join codes** travel in request bodies, never in URLs, so they do not appear in access logs.
- **Request ids.** Every response has an \`X-Request-Id\` header; send your own to correlate.

## Errors

Every error is [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) problem details with
\`Content-Type: application/problem+json\` and a stable \`code\` to switch on:

\`\`\`json
{
  "type": "https://joinly.app/problems/join-code-expired",
  "title": "Join code expired",
  "status": 410,
  "code": "JOIN_CODE_EXPIRED",
  "detail": "This code has expired. Ask your teacher for a new one.",
  "instance": "/v1/enrollments",
  "requestId": "9b2f1c4e-0d7a-4a43-8f55-2c1b8e6f0a12"
}
\`\`\`

\`VALIDATION_FAILED\` adds \`errors: [{ path, message }]\`, one per field. \`RATE_LIMITED\` adds
\`retryAfterSeconds\` and a \`Retry-After\` header.

| Status | Code | Meaning |
| --- | --- | --- |
${(Object.entries(errorStatus) as [ErrorCode, number][])
  .map(([c, s]) => `| ${s} | \`${c}\` | ${ERROR_MEANINGS[c]} |`)
  .join('\n')}

## Endpoints

| Method | Path | Access | Summary |
| --- | --- | --- | --- |
${(Object.values(allEndpoints) as EndpointDef[])
  .map((e) => `| ${e.method} | \`${e.path}\` | ${e.access} | ${e.summary} |`)
  .join('\n')}
| GET | \`/healthz\` | public | Liveness |
| GET | \`/readyz\` | public | Readiness (checks the database) |
`);

for (const e of Object.values(allEndpoints) as EndpointDef[]) {
  out.push(
    `### ${e.method} \`${e.path}\`\n\n${e.summary}.${e.description ? ` ${e.description}` : ''}\n`,
  );
  out.push(`**Auth:** ${accessText[e.access]}\n`);
  if (e.params) out.push(`**Path parameters**\n\n${fieldTable(e.params, 'input')}\n`);
  if (e.query) out.push(`**Query parameters**\n\n${fieldTable(e.query, 'input')}\n`);
  if (e.body)
    out.push(`**Request body**\n\n${fieldTable(e.body, 'input')}\n\n${example(e.body, 'input')}\n`);
  for (const [status, schema] of Object.entries(e.responses)) {
    if (!schema) out.push(`**Response ${status}:** no body.\n`);
    else out.push(`**Response ${status}** (example)\n\n${example(schema)}\n`);
  }
  const errs = [
    ...e.errors,
    ...(e.access === 'public' ? [] : ['UNAUTHENTICATED', 'TOKEN_EXPIRED']),
  ];
  if (e.access === 'teacher' || e.access === 'student') errs.push('FORBIDDEN_ROLE');
  if (e.body || e.query) errs.push('VALIDATION_FAILED');
  out.push(`**Errors:** ${[...new Set(errs)].map((c) => `\`${c}\``).join(', ')}\n`);
}

writeFileSync(new URL('../docs/api.md', import.meta.url), out.join('\n'));
