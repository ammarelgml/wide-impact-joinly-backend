import { pino, type Logger } from 'pino';

/** Paths never written to logs: credentials, tokens and join codes. */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.idToken',
  '*.accessToken',
  '*.refreshToken',
  '*.code',
  '*.token',
];

export function createLogger(level: string, pretty = false): Logger {
  return pino({
    level,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    ...(pretty ? { transport: { target: 'pino-pretty', options: { singleLine: true } } } : {}),
  });
}

export type { Logger };
