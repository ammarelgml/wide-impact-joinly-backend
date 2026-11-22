/**
 * Release step, run by the container before the server starts:
 *   1. apply pending migrations (node-pg-migrate takes an advisory lock, so
 *      concurrent starts are safe),
 *   2. reseed the reviewer demo data when SEED_DEMO_DATA=true.
 * Runs with plain `node`, no package manager needed at runtime.
 */
import { resolve } from 'node:path';
import { runner } from 'node-pg-migrate';
import { loadConfig } from '../src/config/config.js';
import { createDatabase } from '../src/db/database.js';
import { createLogger } from '../src/lib/logger.js';
import { DEMO_JOIN_CODE, seedDemoData } from './seed.js';

const config = loadConfig();
const logger = createLogger(config.logLevel);
/** Resolved from the working directory: the repo root locally, /app in the container. */
const migrationsDir = resolve('migrations');

async function release() {
  const applied = await runner({
    databaseUrl: config.databaseUrl,
    dir: migrationsDir,
    direction: 'up',
    migrationsTable: 'pgmigrations',
    count: Infinity,
    log: (msg) => logger.debug(msg),
  });
  logger.info({ applied: applied.map((m) => m.name) }, 'Migrations up to date');

  if (process.env.SEED_DEMO_DATA === 'true') {
    const db = createDatabase(config.databaseUrl, { max: 2 });
    try {
      await seedDemoData(db, config);
      logger.info({ demoJoinCode: DEMO_JOIN_CODE }, 'Demo data seeded');
    } finally {
      await db.destroy();
    }
  }
}

release().catch((err) => {
  logger.fatal({ err }, 'Release step failed');
  process.exit(1);
});
