import { z } from 'zod';
import { quantityInput } from '../../lib/money';
import { dateInput, optionalText } from '../../lib/validation';
import { paymentMethodInput } from '../payments/payments.schemas';

export const RETURN_CONDITIONS = ['saleable', 'damaged'] as const;
export type ReturnCondition = (typeof RETURN_CONDITIONS)[number];

export const returnSchema = z.object({
  items: z
    .array(
      z.object({
        /** The line's position on the order (1, 2, …). */
        position: z.coerce.number().int().positive(),
        quantity: quantityInput,
        condition: z.enum(RETURN_CONDITIONS, { errorMap: () => ({ message: 'Choose saleable or damaged' }) }).default('saleable'),
      }),
    )
    .min(1, 'Choose at least one item to return')
    .max(200),
  reason: optionalText(300),
  /** 'original' = back to the methods the customer paid with, newest payment first. */
  refundMethod: z.union([z.literal('original'), paymentMethodInput]).default('original'),
  returnDate: dateInput.optional(),
  idempotencyKey: z.string().uuid().optional(),
  dryRun: z.boolean().default(false),
});
export type ReturnInput = z.infer<typeof returnSchema>;
