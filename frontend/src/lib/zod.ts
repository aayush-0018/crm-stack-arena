import type { ZodError } from 'zod';

/** ZodError -> { 'items.0.quantity': 'message' } (first message per field) */
export function zodErrors(err: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_';
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
