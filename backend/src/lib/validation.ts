import { z } from 'zod';

export const idParam = z.object({ id: z.coerce.number().int().positive() });

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const optionalEmail = z
  .union([z.literal(''), z.string().trim().email('Enter a valid email')])
  .nullish()
  .transform((v) => (v ? v : null));

/** 'YYYY-MM-DD' that is a real calendar date (rejects 2026-02-31, month 13, …). */
export const dateInput = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((v) => {
    const [y, m, d] = v.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d));
    return y >= 1900 && t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
  }, 'Not a valid date');

export const escapeLike = (s: string) => s.replace(/[\\%_]/g, '\\$&');

export const paged = <T>(data: T[], total: number, page: number, pageSize: number) => ({
  data,
  total,
  page,
  pageSize,
});
