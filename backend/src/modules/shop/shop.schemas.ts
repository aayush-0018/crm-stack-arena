import { z } from 'zod';
import { optionalEmail, optionalText } from '../../lib/validation';

/** A shop line can be a landline, mobile or toll-free number, so only the shape is checked: 6–15 digits, plus + ( ) - and spaces. */
const shopPhone = z
  .union([
    z.literal(''),
    z
      .string()
      .trim()
      .max(20)
      .regex(/^\+?[\d\s()-]+$/, 'Use digits only, e.g. 0141 2345678')
      .refine((v) => {
        const digits = v.replace(/\D/g, '').length;
        return digits >= 6 && digits <= 15;
      }, 'Enter a phone number with 6 to 15 digits'),
  ])
  .nullish()
  .transform((v) => (v ? v : null));

export const updateShopSchema = z.object({
  name: z.string().trim().min(1, 'Shop name is required').max(120),
  code: z.lazy(() => branchCodeInput),
  phone: shopPhone,
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
  /** Omitted = leave as it is. */
  allowNegativeStock: z.boolean().optional(),
});

export const branchCodeInput = z
  .union([z.literal(''), z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,6}$/, 'Use 2–6 letters or digits, e.g. JPR')])
  .nullish()
  .transform((v) => (v ? v : null));

export const createBranchSchema = z.object({
  name: z.string().trim().min(1, 'Branch name is required').max(120),
  code: branchCodeInput,
  city: optionalText(80),
  phone: shopPhone,
});
