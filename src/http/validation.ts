import type { z } from 'zod';
import type { FieldError } from './problem.js';

/** Flattens zod issues into { path, message } pairs, one per offending field. */
export function toFieldErrors(error: z.ZodError, prefix?: string): FieldError[] {
  return error.issues.flatMap((issue) => {
    const base = issue.path.map(String);
    if (issue.code === 'unrecognized_keys') {
      return issue.keys.map((key) => field([...base, key], 'Unknown field.', prefix));
    }
    return [field(base, issue.message, prefix)];
  });
}

function field(path: string[], message: string, prefix?: string): FieldError {
  return { path: [prefix, ...path].filter(Boolean).join('.') || '(root)', message };
}
