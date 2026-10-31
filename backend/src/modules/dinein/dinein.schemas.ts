import { z } from 'zod';
import { optionalText } from '../../lib/validation';
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

export const floorPlanSchema = z
  .object({
    width: z.number().int().min(400).max(4000),
    height: z.number().int().min(300).max(4000),
    decor: z.array(decorItem).max(400, 'Too many blocks (max 400)'),
    tables: z.array(tableItem).max(200, 'Too many tables (max 200)'),
  })
  .superRefine((p, ctx) => {
    const seen = new Set<string>();
    for (const t of p.tables) {
      const key = t.label.toLowerCase();
      if (seen.has(key)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['tables'], message: `Two tables are called “${t.label}”` });
      seen.add(key);
    }
    for (const it of [...p.tables, ...p.decor]) {
      if (it.x + it.w > p.width || it.y + it.h > p.height) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['tables'], message: 'Something is outside the floor area' });
        break;
      }
    }
  });
export type FloorPlanInput = z.infer<typeof floorPlanSchema>;

export const KITCHEN_STATUSES = ['new', 'preparing', 'ready', 'served'] as const;
export type KitchenStatus = (typeof KITCHEN_STATUSES)[number];
export const kitchenStatusSchema = z.object({ status: z.enum(KITCHEN_STATUSES) });
export const markPaidSchema = z.object({ method: paymentMethodInput });

/** A guest's order from the table QR. Prices always come from the product list, never from here. */
export const guestOrderSchema = z.object({
  items: z
    .array(z.object({ productId: z.number().int().positive(), quantity: z.number().int().min(1).max(50) }))
    .min(1, 'Add at least one item')
    .max(50, 'Too many items in one order'),
  name: optionalText(60),
  note: optionalText(300),
  /** Test switch until online payments exist: the guest says they have paid. */
  paid: z.boolean().default(false),
  idempotencyKey: z.string().uuid(),
});
