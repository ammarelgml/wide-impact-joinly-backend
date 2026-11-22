import { loadConfig } from './config/config.js';
import { createApp } from './app.js';
import { createDatabase } from './db/database.js';
import { systemClock } from './lib/clock.js';
import { createLogger } from './lib/logger.js';
import { GoogleAuthLibraryVerifier } from './modules/auth/google-verifier.js';

const config = loadConfig();
const logger = createLogger(config.logLevel, config.env === 'development');
const db = createDatabase(config.databaseUrl);

const app = createApp({
  config,
  db,
  logger,
  clock: systemClock,
  google: new GoogleAuthLibraryVerifier(config.auth.googleClientIds),
});

const server = app.listen(config.port, () => {
  logger.info(
    { port: config.port, env: config.env, demoLogin: config.auth.demoLoginEnabled },
    'Joinly API listening',
  );
});

// Drain in-flight requests, then close the pool, so deploys drop no requests.
let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down');
  server.close(async () => {
    await db.destroy();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
