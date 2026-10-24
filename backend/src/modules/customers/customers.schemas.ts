import { z } from 'zod';
import { phoneInput } from '../../lib/phone';
import { optionalEmail, optionalText, paginationQuery } from '../../lib/validation';

export const customerInput = z.object({
  name: z.string({ required_error: 'Name is required' }).trim().min(1, 'Name is required').max(120),
  phone: phoneInput,
  email: optionalEmail,
  address: optionalText(500),
  notes: optionalText(1000),
});
export type CustomerInput = z.infer<typeof customerInput>;

export const CUSTOMER_SEGMENTS = ['new', 'active', 'vip', 'forgotten'] as const;
export type CustomerSegment = (typeof CUSTOMER_SEGMENTS)[number];

export const listCustomersQuery = paginationQuery.extend({
  search: z.string().trim().max(100).optional(),
  segment: z.enum(CUSTOMER_SEGMENTS).optional(),
  sort: z.enum(['name', 'created', 'lastOrder', 'spent', 'orders']).default('name'),
  dir: z.enum(['asc', 'desc']).default('asc'),
});
export type ListCustomersQuery = z.infer<typeof listCustomersQuery>;
