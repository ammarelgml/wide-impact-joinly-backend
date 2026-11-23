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
  GOOGLE_WEB_CLIENT_ID: z
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
  SUPPORT_EMAIL: z.email().optional(),
  /** Public https origin of this API. When set, QR codes carry https join links. */
  PUBLIC_URL: z
    .url({ protocol: /^https?$/ })
    .transform((u) => u.replace(/\/+$/, ''))
    .optional(),
  ANDROID_PACKAGE: z
    .string()
    .regex(/^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)+$/)
    .default('com.ammarelgml.joinly'),
  /** Signing-certificate SHA-256 fingerprints (AA:BB:...) for Android App Links. */
  ANDROID_CERT_SHA256: z
    .string()
    .default('')
    .transform((s) =>
      s
        .split(',')
        .map((x) => x.trim().toUpperCase())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().regex(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/))),
  APK_DOWNLOAD_URL: z
    .url()
    .default(
      'https://github.com/ammarelgml/wide-impact-joinly-mobile/releases/latest/download/joinly.apk',
    ),
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
  /** Shown on the public privacy page. */
  supportEmail: string | undefined;
  /** Public origin; when set, join links are https://<publicUrl>/join?code=NNNNNN. */
  publicUrl: string | undefined;
  android: { packageName: string; certSha256: string[]; apkDownloadUrl: string };
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
      googleClientIds: e.GOOGLE_WEB_CLIENT_ID,
      demoLoginEnabled: e.DEMO_LOGIN_ENABLED,
    },
    joinCodeTtlHours: e.JOIN_CODE_TTL_HOURS,
    trustProxy: e.TRUST_PROXY,
    supportEmail: e.SUPPORT_EMAIL,
    publicUrl: e.PUBLIC_URL,
    android: {
      packageName: e.ANDROID_PACKAGE,
      certSha256: e.ANDROID_CERT_SHA256,
      apkDownloadUrl: e.APK_DOWNLOAD_URL,
    },
    validateResponses: e.NODE_ENV !== 'production',
  };
}
