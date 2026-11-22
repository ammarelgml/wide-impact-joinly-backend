import { randomUUID } from 'node:crypto';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { sql } from 'kysely';
import type { Config } from './config/config.js';
import type { Database } from './db/database.js';
import { errorHandler, notFoundHandler } from './http/middleware/error-handler.js';
import { buildOpenApiDocument } from './http/openapi.js';
import { pagesRouter } from './http/pages.js';
import type { RouteDeps } from './http/route.js';
import type { Clock } from './lib/clock.js';
import type { Logger } from './lib/logger.js';
import { MemoryRateLimiter, type RateLimiter } from './lib/rate-limiter.js';
import { authController } from './modules/auth/auth.controller.js';
import { AuthService } from './modules/auth/auth.service.js';
import type { GoogleTokenVerifier } from './modules/auth/google-verifier.js';
import { TokenService } from './modules/auth/token.service.js';
import { classroomController } from './modules/classrooms/classroom.controller.js';
import { ClassroomService } from './modules/classrooms/classroom.service.js';
import { enrollmentController } from './modules/enrollments/enrollment.controller.js';
import { EnrollmentService } from './modules/enrollments/enrollment.service.js';

export interface AppDeps {
  config: Config;
  db: Database;
  logger: Logger;
  clock: Clock;
  google: GoogleTokenVerifier;
  generateCode?: () => string;
  limiters?: Partial<Limiters>;
}

interface Limiters {
  joinFailures: RateLimiter;
  joinIp: RateLimiter;
  authIp: RateLimiter;
}

const MINUTE = 60_000;

/** Composition root: wires services from dependencies and returns the Express app. */
export function createApp(deps: AppDeps): Express {
  const { config, db, clock } = deps;

  const limiters: Limiters = {
    joinFailures: new MemoryRateLimiter(5, 15 * MINUTE, clock), // D7
    joinIp: new MemoryRateLimiter(60, MINUTE, clock),
    authIp: new MemoryRateLimiter(30, MINUTE, clock),
    ...deps.limiters,
  };

  const tokens = new TokenService(db, clock, config.auth);
  const auth = new AuthService(db, deps.google, tokens);
  const classrooms = new ClassroomService(db, clock, {
    joinCodeTtlHours: config.joinCodeTtlHours,
    ...(deps.generateCode && { generateCode: deps.generateCode }),
  });
  const enrollments = new EnrollmentService(db, clock, limiters.joinFailures);
  const routeDeps: RouteDeps = { tokens, validateResponses: config.validateResponses };

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(
    pinoHttp({
      logger: deps.logger,
      genReqId: (req, res) => {
        const incoming = req.headers['x-request-id'];
        const id =
          typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      // Keep access logs small: no headers (they carry tokens), no bodies.
      serializers: {
        req: (req: { id: unknown; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          url: req.url,
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : 'info'),
      autoLogging: { ignore: (req) => req.url === '/healthz' },
    }),
  );

  // API docs, before helmet's strict CSP (Swagger UI needs inline scripts).
  const openApi = buildOpenApiDocument({ demoLoginEnabled: config.auth.demoLoginEnabled });
  app.get('/openapi.json', (_req, res) => res.json(openApi));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApi, { customSiteTitle: 'Joinly API' }));

  app.use(helmet());
  app.use(express.json({ limit: '10kb' }));

  app.use(pagesRouter({ supportEmail: config.supportEmail }));
  app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
  app.get('/readyz', async (_req, res) => {
    await sql`select 1`.execute(db);
    res.json({ status: 'ready' });
  });

  app.use(
    '/',
    authController({
      ...routeDeps,
      auth,
      tokens,
      db,
      authLimiter: limiters.authIp,
      demoLoginEnabled: config.auth.demoLoginEnabled,
    }),
  );
  app.use('/', classroomController({ ...routeDeps, classrooms }));
  app.use('/', enrollmentController({ ...routeDeps, enrollments, joinIpLimiter: limiters.joinIp }));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
