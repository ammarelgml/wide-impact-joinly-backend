import { z } from 'zod';

/**
 * Stable, machine-readable error codes. The mobile app switches on these,
 * never on HTTP status or message text, so messages can change freely.
 */
export const ErrorCode = z
  .enum([
    'VALIDATION_FAILED',
    'UNAUTHENTICATED',
    'TOKEN_EXPIRED',
    'GOOGLE_TOKEN_INVALID',
    'REFRESH_TOKEN_INVALID',
    'FORBIDDEN_ROLE',
    'NOT_FOUND',
    'JOIN_CODE_INVALID',
    'JOINING_CLOSED',
    'JOIN_CODE_EXPIRED',
    'ROLE_REQUIRED',
    'PAYLOAD_TOO_LARGE',
    'RATE_LIMITED',
    'INTERNAL',
  ])
  .meta({ id: 'ErrorCode' });
export type ErrorCode = z.infer<typeof ErrorCode>;

/** HTTP status for each error code. One table, used by the API and documented in OpenAPI. */
export const errorStatus: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  TOKEN_EXPIRED: 401,
  GOOGLE_TOKEN_INVALID: 401,
  REFRESH_TOKEN_INVALID: 401,
  FORBIDDEN_ROLE: 403,
  NOT_FOUND: 404,
  JOIN_CODE_INVALID: 404,
  JOINING_CLOSED: 409,
  JOIN_CODE_EXPIRED: 410,
  ROLE_REQUIRED: 422,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export const FieldError = z.object({
  path: z.string().meta({ description: 'Dot path to the offending field, e.g. "name".' }),
  message: z.string(),
});
export type FieldError = z.infer<typeof FieldError>;

/** RFC 9457 problem details, extended with a stable `code` and the request id. */
export const Problem = z
  .object({
    type: z.string().meta({ example: 'https://joinly.app/problems/join-code-expired' }),
    title: z.string(),
    status: z.int(),
    code: ErrorCode,
    detail: z.string().optional(),
    instance: z.string().optional(),
    requestId: z.string(),
    errors: z.array(FieldError).optional(),
    retryAfterSeconds: z.int().optional(),
  })
  .meta({ id: 'Problem', description: 'RFC 9457 problem details (application/problem+json).' });
export type Problem = z.infer<typeof Problem>;
