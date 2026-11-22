import type { Request, RequestHandler, Response, Router } from 'express';
import type { z } from 'zod';
import type { EndpointDef } from './endpoint.js';
import { AppError } from '../lib/app-error.js';
import type { AuthUser, TokenService } from '../modules/auth/token.service.js';
import { toFieldErrors } from './validation.js';

type Out<S> = S extends z.ZodType ? z.output<S> : undefined;

export interface RouteContext<E extends EndpointDef> {
  params: Out<E['params']>;
  query: Out<E['query']>;
  body: Out<E['body']>;
  user: E['access'] extends 'public' ? undefined : AuthUser;
  req: Request;
}

/** A handler must return one of the endpoint's declared success statuses with its body type. */
export type RouteResult<E extends EndpointDef> = {
  [S in keyof E['responses'] & number]: {
    status: S;
    body: E['responses'][S] extends z.ZodType ? z.input<E['responses'][S]> : undefined;
  };
}[keyof E['responses'] & number];

export interface RouteDeps {
  tokens: TokenService;
  validateResponses: boolean;
}

/**
 * Mounts one endpoint from the contracts catalogue: authentication and role
 * check from `access`, then params/query/body validation with the shared zod
 * schemas, then the handler. Outside production every response is checked
 * against its declared schema, so the OpenAPI document cannot drift from reality.
 */
export function mount<E extends EndpointDef>(
  router: Router,
  endpoint: E,
  deps: RouteDeps,
  handler: (ctx: RouteContext<E>) => Promise<RouteResult<E>>,
  middleware: RequestHandler[] = [],
): void {
  const method = endpoint.method.toLowerCase() as 'get' | 'post' | 'patch' | 'delete';

  router[method](endpoint.path, ...middleware, async (req: Request, res: Response) => {
    const user = endpoint.access === 'public' ? undefined : await authenticate(req, endpoint, deps);

    const ctx = {
      params: parse(endpoint.params, req.params, 'params'),
      query: parse(endpoint.query, req.query, 'query'),
      body: parse(endpoint.body, req.body, 'body'),
      user,
      req,
    } as RouteContext<E>;

    const result = await handler(ctx);
    const schema = endpoint.responses[result.status as 200 | 201 | 204];

    if (deps.validateResponses && schema) {
      const check = schema.safeParse(result.body);
      if (!check.success) {
        throw new Error(
          `Response for ${endpoint.method} ${endpoint.path} violates its contract: ${check.error.message}`,
        );
      }
    }
    if (result.body === undefined) res.status(result.status).end();
    else res.status(result.status).json(result.body);
  });
}

async function authenticate(
  req: Request,
  endpoint: EndpointDef,
  deps: RouteDeps,
): Promise<AuthUser> {
  const header = req.headers.authorization;
  const match = header ? /^Bearer ([A-Za-z0-9._~+/-]+=*)$/.exec(header) : null;
  if (!match?.[1]) throw new AppError('UNAUTHENTICATED', 'Missing or malformed bearer token.');
  const user = await deps.tokens.verifyAccessToken(match[1]);
  if (endpoint.access !== 'authenticated' && endpoint.access !== user.role) {
    throw new AppError('FORBIDDEN_ROLE', `This action is only available to ${endpoint.access}s.`);
  }
  return user;
}

function parse(schema: z.ZodType | undefined, value: unknown, where: 'params' | 'query' | 'body') {
  if (!schema) return undefined;
  // Express gives an empty body as undefined; validate it as an empty object so
  // the client gets field-level errors instead of a generic type error.
  const result = schema.safeParse(value ?? {});
  if (!result.success) {
    // Malformed ids in the path are "not found", not a client schema error.
    if (where === 'params') throw new AppError('NOT_FOUND', 'Resource not found.');
    throw new AppError('VALIDATION_FAILED', `Request ${where} is invalid.`, {
      errors: toFieldErrors(result.error, where === 'query' ? 'query' : undefined),
    });
  }
  return result.data;
}

/** Typed success results; keep the status a literal so it is checked against the contract. */
export const ok = <B>(body: B) => ({ status: 200 as const, body });
export const created = <B>(body: B) => ({ status: 201 as const, body });
export const noContent = () => ({ status: 204 as const, body: undefined });
