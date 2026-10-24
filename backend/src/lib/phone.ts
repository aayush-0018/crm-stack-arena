import { z } from 'zod';

/** Strips spaces, dashes, +91 / 0 prefixes. */
export function normalisePhone(raw: string): string {
  let d = raw.replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d;
}

export const phoneInput = z
  .string({ required_error: 'Phone is required' })
  .transform(normalisePhone)
  .refine((v) => /^[6-9]\d{9}$/.test(v), 'Enter a valid 10-digit mobile number');
