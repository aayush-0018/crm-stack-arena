import { z } from 'zod';
import { moneyInput } from '../../lib/money';
import { dateInput, optionalText } from '../../lib/validation';

/** Methods a person can pick. 'unrecorded' exists only for history imported from before the ledger. */
export const PAYMENT_METHODS = ['cash', 'upi', 'card', 'bank', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number] | 'unrecorded';
export type PaymentKind = 'payment' | 'refund';

export const paymentMethodInput = z.enum(PAYMENT_METHODS, {
  errorMap: () => ({ message: 'Choose how it was paid' }),
});

export const paymentEntrySchema = z.object({
  kind: z.enum(['payment', 'refund']).default('payment'),
  amount: moneyInput.refine((p) => p > 0, 'Amount must be more than 0'),
  method: paymentMethodInput,
  paidOn: dateInput.optional(),
  reference: optionalText(100),
  note: optionalText(300),
  idempotencyKey: z.string().uuid().optional(),
});
export type PaymentEntryInput = z.infer<typeof paymentEntrySchema>;

export const voidPaymentSchema = z.object({ reason: optionalText(300) });
