import { z } from 'zod';
import type { EndpointDef } from './endpoint.js';
import { type ErrorCode, errorStatus } from './problem.js';
import { allEndpoints } from './endpoints.js';

/**
 * Builds the OpenAPI 3.1 document from the contracts catalogue. Nothing here is
 * hand-written per endpoint: paths, schemas and errors all come from the same
 * zod schemas the API validates with.
 */
const COMMON_ERRORS: ErrorCode[] = ['VALIDATION_FAILED', 'INTERNAL'];
const AUTH_ERRORS: ErrorCode[] = ['UNAUTHENTICATED', 'TOKEN_EXPIRED'];

const ref = (id: string) => ({ $ref: `#/components/schemas/${id}` });

function schemaFor(schema: z.ZodType, io: 'input' | 'output') {
  const id = z.globalRegistry.get(schema)?.id;
  if (id) return ref(id);
  const json = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    io,
    unrepresentable: 'any',
    metadata: z.globalRegistry,
  }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

function parameters(schema: z.ZodType | undefined, where: 'path' | 'query') {
  if (!schema || !(schema instanceof z.ZodObject)) return [];
  return Object.entries(schema.shape as Record<string, z.ZodType>).map(([name, field]) => ({
    name,
    in: where,
    required: where === 'path' || !field.safeParse(undefined).success,
    schema: schemaFor(field, 'input'),
    ...(field.description ? { description: field.description } : {}),
  }));
}

function operation(name: string, e: EndpointDef) {
  const errorCodes = [
    ...new Set([...e.errors, ...(e.access === 'public' ? [] : AUTH_ERRORS), ...COMMON_ERRORS]),
  ];
  if (e.access === 'teacher' || e.access === 'student') errorCodes.push('FORBIDDEN_ROLE');

  const byStatus = new Map<number, ErrorCode[]>();
  for (const code of errorCodes) {
    const s = errorStatus[code];
    byStatus.set(s, [...(byStatus.get(s) ?? []), code]);
  }

  const responses: Record<string, unknown> = {};
  for (const [status, schema] of Object.entries(e.responses)) {
    responses[status] = schema
      ? {
          description: 'Success',
          content: { 'application/json': { schema: schemaFor(schema, 'output') } },
        }
      : { description: 'No content' };
  }
  for (const [status, codes] of [...byStatus].sort(([a], [b]) => a - b)) {
    responses[String(status)] = {
      description: `Error. \`code\` is one of: ${codes.map((c) => `\`${c}\``).join(', ')}`,
      content: { 'application/problem+json': { schema: ref('Problem') } },
      ...(status === 429 ? { headers: { 'Retry-After': { schema: { type: 'integer' } } } } : {}),
    };
  }

  const access =
    e.access === 'public'
      ? 'Public.'
      : e.access === 'authenticated'
        ? 'Any signed-in user.'
        : `Role: ${e.access}.`;

  return {
    operationId: name,
    tags: [e.tag],
    summary: e.summary,
    description: [access, e.description].filter(Boolean).join('\n\n'),
    ...(e.access === 'public' ? { security: [] } : {}),
    parameters: [...parameters(e.params, 'path'), ...parameters(e.query, 'query')],
    ...(e.body
      ? {
          requestBody: {
            required: true,
            content: { 'application/json': { schema: schemaFor(e.body, 'input') } },
          },
        }
      : {}),
    responses,
  };
}

export function buildOpenApiDocument(
  opts: { serverUrl?: string; demoLoginEnabled?: boolean } = {},
) {
  const components = z.toJSONSchema(z.globalRegistry, {
    target: 'draft-2020-12',
    unrepresentable: 'any',
    uri: (id) => `#/components/schemas/${id}`,
  }).schemas as Record<string, Record<string, unknown>>;
  for (const s of Object.values(components)) {
    delete s.$schema;
    delete s.$id;
  }

  const paths: Record<string, Record<string, unknown>> = {};
  for (const [name, e] of Object.entries(allEndpoints) as [string, EndpointDef][]) {
    if (name === 'demoSignIn' && opts.demoLoginEnabled === false) continue;
    const path = e.path.replace(/:(\w+)/g, '{$1}');
    paths[path] = { ...paths[path], [e.method.toLowerCase()]: operation(name, e) };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Joinly API',
      version: '1.0.0',
      description:
        'REST API for Joinly: teachers create classrooms, students join by QR or 6-digit code.\n\n' +
        '**Auth.** Exchange a Google ID token at `POST /v1/auth/google` for an access token (15 min JWT) ' +
        'and a rotating refresh token (30 days). Send `Authorization: Bearer <accessToken>`. On ' +
        '`401 TOKEN_EXPIRED`, call `POST /v1/auth/refresh` once and retry.\n\n' +
        '**Errors.** Every error is RFC 9457 problem details with a stable `code`.',
    },
    servers: opts.serverUrl ? [{ url: opts.serverUrl }] : [],
    security: [{ bearer: [] }],
    tags: [
      { name: 'Auth' },
      { name: 'Me' },
      { name: 'Classrooms', description: 'Teacher only. Non-owned classrooms return 404.' },
      { name: 'Enrollments', description: 'Student only.' },
    ],
    paths,
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      schemas: components,
    },
  };
}
