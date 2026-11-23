import { Kysely, PostgresDialect, type Transaction } from 'kysely';
import pg from 'pg';
import type { DB } from './schema.js';

export type Database = Kysely<DB>;
export type Executor = Kysely<DB> | Transaction<DB>;

export function createDatabase(connectionString: string, options: { max?: number } = {}): Database {
  const pool = new pg.Pool({
    connectionString,
    max: options.max ?? 10,
    // Fail fast instead of queueing requests forever if the database stalls.
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000,
    // Managed Postgres (Railway, Neon) needs TLS; local does not.
    ssl: /sslmode=require/.test(connectionString) ? { rejectUnauthorized: false } : undefined,
  });
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}

/** Postgres unique-violation on a given constraint or index. */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = err as { code?: string; constraint?: string };
  return e?.code === '23505' && (constraint === undefined || e.constraint === constraint);
}

export function isForeignKeyViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === '23503';
}
