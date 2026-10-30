import { z } from 'zod';
import { moneyInput, quantityToMilli } from '../../lib/money';
import { optionalText, paginationQuery } from '../../lib/validation';

export const PRODUCT_UNITS = ['pcs', 'kg', 'g', 'l', 'ml', 'm', 'box', 'pack', 'dozen', 'pair', 'set'] as const;

const QTY_RE = /^\d{1,7}(\.\d{1,3})?$/;
/** A stock quantity: up to 3 decimals, may be 0. Outputs milli-units. */
export const stockQtyInput = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => QTY_RE.test(v), 'Enter a quantity, e.g. 12 or 2.5')
  .transform(quantityToMilli);

const optionalQty = z
  .union([z.literal(''), z.null(), stockQtyInput])
  .optional()
  .transform((v) => (v === '' || v === null || v === undefined ? null : v));

export const productInput = z.object({
  name: z.string({ required_error: 'Name is required' }).trim().min(1, 'Name is required').max(120),
  sku: optionalText(40),
  category: optionalText(60),
  unit: z.enum(PRODUCT_UNITS).default('pcs'),
  price: moneyInput,
  cost: z
    .union([z.literal(''), z.null(), moneyInput])
    .optional()
    .transform((v) => (v === '' || v === null || v === undefined ? null : v)),
  trackStock: z.boolean().default(true),
  /** Warn when stock falls to this level or below. Empty = no warning (except below zero). */
  lowStockAt: optionalQty,
});
export type ProductInput = z.infer<typeof productInput>;

export const createProductSchema = productInput.extend({
  /** Stock on hand when the product is added; recorded as an "opening" movement. */
  openingStock: optionalQty,
});

export const listProductsQuery = paginationQuery.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(['active', 'low', 'archived']).default('active'),
});
export type ListProductsQuery = z.infer<typeof listProductsQuery>;

/**
 * receipt   - stock came in (+qty)
 * write_off - damaged / lost / expired (-qty)
 * stocktake - you counted it: qty is the counted amount, the difference is recorded
 */
export const stockEntrySchema = z.object({
  kind: z.enum(['receipt', 'write_off', 'stocktake']),
  qty: stockQtyInput,
  note: optionalText(300),
  idempotencyKey: z.string().uuid().optional(),
});
export type StockEntryInput = z.infer<typeof stockEntrySchema>;
