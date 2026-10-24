import { z } from 'zod';
import { optionalEmail, optionalText } from '../../lib/validation';

export const updateShopSchema = z.object({
  name: z.string().trim().min(1, 'Shop name is required').max(120),
  code: z.lazy(() => branchCodeInput),
  phone: optionalText(20),
  email: optionalEmail,
  addressLine1: optionalText(200),
  addressLine2: optionalText(200),
  city: optionalText(80),
  state: optionalText(80),
  pincode: z
    .union([z.literal(''), z.string().trim().regex(/^\d{6}$/, 'Enter a 6-digit pincode')])
    .nullish()
    .transform((v) => (v ? v : null)),
  gstin: z
    .union([
      z.literal(''),
      z.string().trim().toUpperCase().regex(/^[0-9A-Z]{15}$/, 'GSTIN must be 15 characters'),
    ])
    .nullish()
    .transform((v) => (v ? v : null)),
});

export const branchCodeInput = z
  .union([z.literal(''), z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,6}$/, 'Use 2–6 letters or digits, e.g. JPR')])
  .nullish()
  .transform((v) => (v ? v : null));

export const createBranchSchema = z.object({
  name: z.string().trim().min(1, 'Branch name is required').max(120),
  code: branchCodeInput,
  city: optionalText(80),
  phone: optionalText(20),
});
