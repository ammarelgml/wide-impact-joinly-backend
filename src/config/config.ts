import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.url(),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  GOOGLE_CLIENT_IDS: z
    .string()
    .min(1)
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  JOIN_CODE_TTL_HOURS: z.coerce
    .number()
    .positive()
    .max(24 * 30)
    .default(24),
  DEMO_LOGIN_ENABLED: bool.default(false),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
});

export interface Config {
  env: 'development' | 'test' | 'production';
  port: number;
  logLevel: string;
  databaseUrl: string;
  auth: {
    accessTokenSecret: string;
    accessTokenTtlSeconds: number;
    refreshTokenTtlDays: number;
    googleClientIds: string[];
    demoLoginEnabled: boolean;
  };
  joinCodeTtlHours: number;
  trustProxy: number;
  /** Check every response against its contract schema. On outside production. */
  validateResponses: boolean;
}

/** Parses and validates the environment once at boot. Fails fast with every problem listed. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${issues.join('\n')}`);
  }
  const e = parsed.data;
  return {
    env: e.NODE_ENV,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    databaseUrl: e.DATABASE_URL,
    auth: {
      accessTokenSecret: e.JWT_ACCESS_SECRET,
      accessTokenTtlSeconds: e.ACCESS_TOKEN_TTL_SECONDS,
      refreshTokenTtlDays: e.REFRESH_TOKEN_TTL_DAYS,
      googleClientIds: e.GOOGLE_CLIENT_IDS,
      demoLoginEnabled: e.DEMO_LOGIN_ENABLED,
    },
    joinCodeTtlHours: e.JOIN_CODE_TTL_HOURS,
    trustProxy: e.TRUST_PROXY,
    validateResponses: e.NODE_ENV !== 'production',
  };
}
