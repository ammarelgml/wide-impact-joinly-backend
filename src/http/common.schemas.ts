import { z } from 'zod';

export const Id = z.uuid();
export const Timestamp = z.iso
  .datetime({ offset: true })
  .meta({ example: '2026-11-22T19:30:00.000Z' });

export const PageQuery = z.strictObject({
  cursor: z
    .string()
    .max(200)
    .optional()
    .meta({ description: 'Opaque cursor from a previous page.' }),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type PageQuery = z.infer<typeof PageQuery>;

export const page = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    nextCursor: z.string().nullable().meta({ description: 'Null when this is the last page.' }),
  });

export type Page<T> = { items: T[]; nextCursor: string | null };
