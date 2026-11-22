import { z } from 'zod';
import { AppError } from './app-error.js';

/**
 * Keyset pagination cursor: the (timestamp, id) of the last row on the page,
 * base64url-encoded. Opaque to clients; stable under concurrent inserts.
 */
const CursorSchema = z.object({ t: z.iso.datetime({ offset: true }), id: z.uuid() });
export type Cursor = { t: Date; id: string };

export function encodeCursor(t: Date, id: string): string {
  return Buffer.from(JSON.stringify({ t: t.toISOString(), id })).toString('base64url');
}

export function decodeCursor(raw: string | undefined): Cursor | undefined {
  if (raw === undefined) return undefined;
  try {
    const parsed = CursorSchema.parse(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')));
    return { t: new Date(parsed.t), id: parsed.id };
  } catch {
    throw new AppError('VALIDATION_FAILED', 'Invalid pagination cursor.', {
      errors: [{ path: 'cursor', message: 'Invalid cursor' }],
    });
  }
}

/** Given limit+1 fetched rows, returns the page and the cursor for the next one. */
export function toPage<R, T>(
  rows: R[],
  limit: number,
  keyOf: (row: R) => { t: Date; id: string },
  map: (row: R) => T,
): { items: T[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows.at(-1);
  const nextCursor = hasMore && last ? encodeCursor(keyOf(last).t, keyOf(last).id) : null;
  return { items: pageRows.map(map), nextCursor };
}
