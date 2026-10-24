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

export const escapeLike = (s: string) => s.replace(/[\\%_]/g, '\\$&');

export const paged = <T>(data: T[], total: number, page: number, pageSize: number) => ({
  data,
  total,
  page,
  pageSize,
});
