import type { z } from 'zod';
import type { ErrorCode } from './problem.js';

export type Access = 'public' | 'authenticated' | 'teacher' | 'student';
export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/**
 * One API operation, declared as data. `mount()` turns it into an Express route
 * (auth, role check, validation) and `buildOpenApiDocument()` into its OpenAPI
 * operation, so the published contract cannot drift from what the server enforces.
 */
export interface EndpointDef {
  method: HttpMethod;
  /** Express-style path, e.g. /v1/classrooms/:id */
  path: string;
  tag: 'Auth' | 'Me' | 'Classrooms' | 'Enrollments';
  summary: string;
  description?: string;
  access: Access;
  params?: z.ZodType;
  query?: z.ZodType;
  body?: z.ZodType;
  /** Success responses by status. null means no body (204). */
  responses: Partial<Record<200 | 201 | 204, z.ZodType | null>>;
  /** Error codes specific to this endpoint (auth and validation errors are added automatically). */
  errors: readonly ErrorCode[];
}

/** Identity helper that keeps literal types while checking the shape. */
export const defineEndpoints = <const T extends Record<string, EndpointDef>>(defs: T): T => defs;
