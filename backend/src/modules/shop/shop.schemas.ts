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
  /** Omitted = leave as it is; blank = no review step after table orders. */
  googleReviewUrl: z.lazy(() => googleReviewInput).optional(),
});

const REVIEW_HINT = "Paste the review link from your Google Business Profile (Ask for reviews), or your Place ID";

/**
 * Where guests are sent to rate the branch. Only links that open Google's own review box (stars and
 * the text box) are accepted: the g.page/r/…/review link from "Ask for reviews", a
 * search.google.com/local/writereview link, or a bare Place ID (turned into the latter).
 */
export const googleReviewInput = z
  .union([z.literal(''), z.string().trim().max(500)])
  .nullable()
  .transform((v, ctx) => {
    if (!v) return null;
    if (/^[A-Za-z0-9_-]{16,200}$/.test(v)) return `https://search.google.com/local/writereview?placeid=${v}`;
    let u: URL;
    try {
      u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: REVIEW_HINT });
      return z.NEVER;
    }
    const host = u.hostname.toLowerCase();
    const placeId = u.searchParams.get('placeid');
    if (host === 'g.page' && /^\/r\/[A-Za-z0-9_-]+\/review\/?$/.test(u.pathname)) return `https://g.page${u.pathname}`;
    if (host === 'search.google.com' && u.pathname === '/local/writereview' && placeId && /^[A-Za-z0-9_-]{16,200}$/.test(placeId)) {
      return `https://search.google.com/local/writereview?placeid=${placeId}`;
    }
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: REVIEW_HINT });
    return z.NEVER;
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
