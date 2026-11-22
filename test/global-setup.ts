import { execFileSync } from 'node:child_process';
import pg from 'pg';

/** Rebuilds the test database schema from the real migrations once per run. */
export default async function setup() {
  const url =
    process.env.TEST_DATABASE_URL ?? 'postgres://joinly:joinly@localhost:5432/joinly_test';
  process.env.TEST_DATABASE_URL = url;

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await client.end();

  execFileSync(
    'node-pg-migrate',
    [
      'up',
      '--migrations-dir',
      'migrations',
      '--migration-file-language',
      'sql',
      '--database-url-var',
      'DATABASE_URL',
    ],
    { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' },
  );
}
