// Writes the OpenAPI document to stdout: `pnpm --filter @joinly/api openapi > openapi.json`
import { buildOpenApiDocument } from './openapi.js';

process.stdout.write(`${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`);
