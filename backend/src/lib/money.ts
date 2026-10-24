import { z } from 'zod';

const MONEY_RE = /^\d{1,10}(\.\d{1,2})?$/;
const QTY_RE = /^\d{1,5}(\.\d{1,3})?$/;

/** "125.5" -> 12550 (no floating point) */
export function rupeesToPaise(value: string): number {
  const [r, p = ''] = value.split('.');
  return Number(r) * 100 + Number((p + '00').slice(0, 2));
}

/** "1.25" -> 1250 milli-units */
export function quantityToMilli(value: string): number {
  const [i, f = ''] = value.split('.');
  return Number(i) * 1000 + Number((f + '000').slice(0, 3));
}

/** 1250 -> "1.250" (matches NUMERIC(10,3)) */
export function milliToQuantity(milli: number): string {
  return `${Math.floor(milli / 1000)}.${String(milli % 1000).padStart(3, '0')}`;
}

/** round(qtyMilli * pricePaise / 1000), half-up, using BigInt to avoid overflow */
export function lineTotalPaise(qtyMilli: number, unitPricePaise: number): number {
  return Number((BigInt(qtyMilli) * BigInt(unitPricePaise) + 500n) / 1000n);
}

/** 12550 -> "Rs. 125.50" (PDF standard fonts have no ₹ glyph) */
export function formatRupees(paise: number): string {
  const n = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `Rs. ${n.format(paise / 100)}`;
}

const numberish = z.union([z.string(), z.number()]).transform((v) => String(v).trim());

/** Accepts rupees (string or number, max 2 decimals), outputs paise. */
export const moneyInput = numberish
  .refine((v) => MONEY_RE.test(v), 'Enter a valid amount (up to 2 decimals)')
  .transform(rupeesToPaise);

/** Accepts quantity (max 3 decimals, > 0), outputs milli-units. */
export const quantityInput = numberish
  .refine((v) => QTY_RE.test(v), 'Enter a valid quantity (up to 3 decimals)')
  .transform(quantityToMilli)
  .refine((m) => m > 0, 'Quantity must be greater than 0');
