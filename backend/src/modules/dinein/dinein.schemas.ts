import { z } from 'zod';
import { optionalText } from '../../lib/validation';
import { phoneInput } from '../../lib/phone';
import { paymentMethodInput } from '../payments/payments.schemas';

const rotation = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0);
const coord = z.number().int().min(0).max(4000);
const size = z.number().int().min(20).max(1000);

export const DECOR_KINDS = ['wall', 'counter', 'kitchen', 'door', 'window', 'plant', 'zone', 'text'] as const;

const decorItem = z.object({
  id: z.string().min(1).max(40),
  kind: z.enum(DECOR_KINDS),
  x: coord,
  y: coord,
  w: z.number().int().min(4).max(4000),
  h: z.number().int().min(4).max(4000),
  rotation,
  label: optionalText(40),
});

const tableItem = z.object({
  /** Missing = a new table. */
  id: z.number().int().positive().optional(),
  label: z.string().trim().min(1, 'Every table needs a name').max(20, 'Table names are at most 20 characters'),
  seats: z.number().int().min(1).max(30),
  shape: z.enum(['square', 'round', 'rect']),
  x: coord,
  y: coord,
  w: size,
  h: size,
  rotation,
});

const floorItem = z
  .object({
    /** Missing = a new floor. */
    id: z.number().int().positive().optional(),
    name: z.string().trim().min(1, 'Every floor needs a name').max(40, 'Floor names are at most 40 characters'),
    width: z.number().int().min(400).max(4000),
    height: z.number().int().min(300).max(4000),
    decor: z.array(decorItem).max(400, 'Too many blocks on one floor (max 400)'),
    tables: z.array(tableItem).max(200, 'Too many tables on one floor (max 200)'),
  })
  .superRefine((f, ctx) => {
    for (const it of [...f.tables, ...f.decor]) {
      if (it.x + it.w > f.width || it.y + it.h > f.height) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['tables'], message: `Something on “${f.name}” is outside the floor area` });
        break;
      }
    }
  });

export const floorPlanSchema = z
  .object({ floors: z.array(floorItem).min(1, 'Keep at least one floor').max(20, 'At most 20 floors') })
  .superRefine((p, ctx) => {
    const names = new Set<string>();
    const labels = new Set<string>();
    for (const f of p.floors) {
      const n = f.name.toLowerCase();
      if (names.has(n)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['floors'], message: `Two floors are called “${f.name}”` });
      names.add(n);
      // Table names are unique across the whole café: the kitchen shows only the table name.
      for (const t of f.tables) {
        const key = t.label.toLowerCase();
        if (labels.has(key)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['tables'], message: `Two tables are called “${t.label}”` });
        labels.add(key);
      }
    }
  });
export type FloorPlanInput = z.infer<typeof floorPlanSchema>;

export const KITCHEN_STATUSES = ['new', 'preparing', 'ready', 'served'] as const;
export type KitchenStatus = (typeof KITCHEN_STATUSES)[number];
export const kitchenStatusSchema = z.object({ status: z.enum(KITCHEN_STATUSES) });
export const markPaidSchema = z.object({ method: paymentMethodInput });

/** Step 1 at the table: who's ordering. All three are required; the email gets a one-time code. */
export const guestOtpRequestSchema = z.object({
  name: z.string({ required_error: 'Name is required' }).trim().min(1, 'Name is required').max(60),
  phone: phoneInput,
  email: z.string({ required_error: 'Email is required' }).trim().toLowerCase().email('Enter a valid email').max(254),
});

export const guestOtpVerifySchema = z.object({
  challenge: z.string().regex(/^[A-Za-z0-9_-]{20,64}$/),
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

/** A guest's order from the table QR. Prices always come from the product list, never from here. */
export const guestOrderSchema = z.object({
  items: z
    .array(z.object({ productId: z.number().int().positive(), quantity: z.number().int().min(1).max(50) }))
    .min(1, 'Add at least one item')
    .max(50, 'Too many items in one order'),
  note: optionalText(300),
  /** Test switch until online payments exist: the guest says they have paid. */
  paid: z.boolean().default(false),
  idempotencyKey: z.string().uuid(),
});
