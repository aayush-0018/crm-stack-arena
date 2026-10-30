import { z } from 'zod';
import { moneyInput, quantityInput } from '../../lib/money';
import { optionalText, paginationQuery } from '../../lib/validation';
import { customerInput } from '../customers/customers.schemas';

export const ORDER_STATUSES = ['open', 'completed', 'cancelled'] as const;
export const PAYMENT_STATUSES = ['unpaid', 'partial', 'paid'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

const MAX_UNIT_PRICE_PAISE = 1_00_00_000_00; // Rs 1 crore per unit

const lineItemInput = z.object({
  itemName: z.string({ required_error: 'Item name is required' }).trim().min(1, 'Item name is required').max(200),
  quantity: quantityInput.refine((m) => m <= 99_999_000, 'Quantity is too large'),
  unitPrice: moneyInput.refine((p) => p <= MAX_UNIT_PRICE_PAISE, 'Price is too large'),
});
export type LineItemInput = z.infer<typeof lineItemInput>;

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

const orderBody = {
  items: z.array(lineItemInput).min(1, 'Add at least one item').max(200, 'Too many items (max 200)'),
  discount: moneyInput.default(0),
  notes: optionalText(1000),
  orderDate: dateString.optional(),
};

export const createOrderSchema = z
  .object({
    ...orderBody,
    idempotencyKey: z.string().uuid().optional(),
    customerId: z.coerce.number().int().positive().optional(),
    newCustomer: customerInput.nullish(),
    amountPaid: moneyInput.default(0),
  })
  .refine((o) => Boolean(o.customerId) !== Boolean(o.newCustomer), {
    message: 'Select an existing customer or add a new one',
    path: ['customerId'],
  });
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const updateOrderSchema = z.object({
  ...orderBody,
  amountPaid: moneyInput.optional(),
});
export type UpdateOrderInput = z.infer<typeof updateOrderSchema>;

export const statusSchema = z.object({ status: z.enum(ORDER_STATUSES) });
export const paymentSchema = z.object({ amountPaid: moneyInput });

export const listOrdersQuery = paginationQuery.extend({
  search: z.string().trim().max(100).optional(),
  customerId: z.coerce.number().int().positive().optional(),
  status: z.enum(ORDER_STATUSES).optional(),
  paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
  /** Money still owed: not cancelled, and paid less than the total. */
  due: z.enum(['true', 'false']).optional(),
  from: dateString.optional(),
  to: dateString.optional(),
  sort: z.enum(['date', 'total', 'number']).default('date'),
  dir: z.enum(['asc', 'desc']).default('desc'),
});
export type ListOrdersQuery = z.infer<typeof listOrdersQuery>;
