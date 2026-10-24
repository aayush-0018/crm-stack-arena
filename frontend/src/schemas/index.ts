import { z } from 'zod';
import { isValidMoney, isValidQty } from '../lib/money';

/** Mirrors the backend: strips spaces / +91 / leading 0. */
export function normalisePhone(raw: string): string {
  let d = raw.replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d;
}

const optional = (max: number) => z.string().trim().max(max, `Max ${max} characters`);

export const customerSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  phone: z
    .string()
    .transform(normalisePhone)
    .refine((v) => /^[6-9]\d{9}$/.test(v), 'Enter a valid 10-digit mobile number'),
  email: z.union([z.literal(''), z.string().trim().email('Enter a valid email')]),
  address: optional(500),
  notes: optional(1000),
});
export type CustomerFormValues = z.input<typeof customerSchema>;

export const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

export const registerSchema = z.object({
  shopName: z.string().trim().min(1, 'Shop name is required'),
  name: z.string().trim().min(1, 'Your name is required'),
  email: z.string().trim().email('Enter a valid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

const money = (msg = 'Enter a valid amount (up to 2 decimals)') =>
  z.string().refine((v) => isValidMoney(v || '0'), msg);

export const lineItemSchema = z.object({
  itemName: z.string().trim().min(1, 'Item name is required').max(200),
  quantity: z.string().refine(isValidQty, 'Enter a quantity above 0 (up to 3 decimals)'),
  unit: z.string().trim().max(20),
  unitPrice: z.string().refine(isValidMoney, 'Enter a valid price'),
});

export const orderSchema = z.object({
  items: z.array(lineItemSchema).min(1, 'Add at least one item').max(200, 'Too many items (max 200)'),
  discount: money(),
  amountPaid: money(),
  notes: optional(1000),
});
