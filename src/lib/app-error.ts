import { type ErrorCode, type FieldError, errorStatus } from '../http/problem.js';

/**
 * The only error type services throw on purpose. The error middleware turns it
 * into RFC 9457 problem details; anything else becomes a logged 500.
 */
export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly extra: { errors?: FieldError[]; retryAfterSeconds?: number } = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.status = errorStatus[code];
  }
}

export const notFound = (what = 'Resource') => new AppError('NOT_FOUND', `${what} not found.`);
