import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { ErrorCode, Problem } from '../problem.js';
import { AppError } from '../../lib/app-error.js';

const TITLES: Record<ErrorCode, string> = {
  VALIDATION_FAILED: 'Validation failed',
  UNAUTHENTICATED: 'Authentication required',
  TOKEN_EXPIRED: 'Access token expired',
  GOOGLE_TOKEN_INVALID: 'Google sign-in failed',
  REFRESH_TOKEN_INVALID: 'Session expired',
  FORBIDDEN_ROLE: 'Not allowed for this role',
  NOT_FOUND: 'Not found',
  JOIN_CODE_INVALID: 'Invalid join code',
  JOINING_CLOSED: 'Joining is closed',
  JOIN_CODE_EXPIRED: 'Join code expired',
  ROLE_REQUIRED: 'Role required',
  PAYLOAD_TOO_LARGE: 'Payload too large',
  RATE_LIMITED: 'Too many requests',
  INTERNAL: 'Internal server error',
};

export const problemType = (code: ErrorCode) =>
  `https://joinly.app/problems/${code.toLowerCase().replaceAll('_', '-')}`;

export const notFoundHandler: RequestHandler = () => {
  throw new AppError('NOT_FOUND', 'No such endpoint.');
};

/** Every failure leaves the API as RFC 9457 problem details with a stable code. */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const appError = toAppError(err);
  if (appError.code === 'INTERNAL') {
    req.log.error({ err }, 'Unhandled error');
  }

  const body: Problem = {
    type: problemType(appError.code),
    title: TITLES[appError.code],
    status: appError.status,
    code: appError.code,
    detail: appError.message,
    instance: req.originalUrl.split('?')[0],
    requestId: String(req.id),
    ...(appError.extra.errors ? { errors: appError.extra.errors } : {}),
    ...(appError.extra.retryAfterSeconds !== undefined
      ? { retryAfterSeconds: appError.extra.retryAfterSeconds }
      : {}),
  };

  if (appError.extra.retryAfterSeconds !== undefined) {
    res.setHeader('Retry-After', String(appError.extra.retryAfterSeconds));
  }
  res.status(appError.status).type('application/problem+json').json(body);
};

function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  // Errors raised by express.json() before our code runs.
  const e = err as { type?: string; status?: number };
  if (e?.type === 'entity.too.large')
    return new AppError('PAYLOAD_TOO_LARGE', 'Request body is too large.');
  if (e?.type === 'entity.parse.failed')
    return new AppError('VALIDATION_FAILED', 'Body is not valid JSON.');
  if (e?.status && e.status >= 400 && e.status < 500) {
    return new AppError('VALIDATION_FAILED', 'Malformed request.');
  }
  return new AppError('INTERNAL', 'Something went wrong. Try again.');
}
