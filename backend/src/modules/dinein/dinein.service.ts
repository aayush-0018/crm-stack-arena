import { randomBytes } from 'crypto';
import { Db, pool } from '../../db/pool';
import { withTransaction } from '../../db/tx';
import { AppError, notFound } from '../../lib/errors';
import { createOrder } from '../orders/orders.service';
import { PaymentMethod } from '../payments/payments.schemas';
import { recordEntry } from '../payments/payments.service';
import { FloorPlanInput, KitchenStatus } from './dinein.schemas';

export const newToken = () => randomBytes(18).toString('base64url');

export interface DiningTable {
  id: number;
  label: string;
  seats: number;
  shape: 'square' | 'round' | 'rect';
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  qrToken: string;
}

const TABLE_COLS = `id, label, seats, shape, x, y, w, h, rotation, qr_token AS "qrToken"`;

/** The branch's floor plan; an empty unlocked one if it was never saved. */
export async function getFloorPlan(db: Db, shopId: number) {
  const [{ rows: plan }, { rows: tables }] = await Promise.all([
    db.query(`SELECT width, height, decor, locked, updated_at AS "updatedAt" FROM floor_plans WHERE shop_id = $1`, [shopId]),
    db.query(`SELECT ${TABLE_COLS} FROM dining_tables WHERE shop_id = $1 AND active ORDER BY id`, [shopId]),
  ]);
  return {
    width: 1200,
    height: 800,
    decor: [],
    locked: false,
    updatedAt: null,
    ...plan[0],
    tables: tables as DiningTable[],
  };
}

const locked = () => new AppError(409, 'PLAN_LOCKED', 'The floor plan is locked. Unlock it to make changes.');

/**
 * Saves the whole plan. Tables keep their id (and so their QR code) when moved or renamed; tables
 * left out are removed: kept for their orders, but their QR code stops working.
 */
export async function saveFloorPlan(shopId: number, userId: number, p: FloorPlanInput) {
  await withTransaction(async (c) => {
    await c.query(`INSERT INTO floor_plans (shop_id) VALUES ($1) ON CONFLICT DO NOTHING`, [shopId]);
    const { rows } = await c.query(`SELECT locked FROM floor_plans WHERE shop_id = $1 FOR UPDATE`, [shopId]);
    if (rows[0].locked) throw locked();

    const { rows: current } = await c.query(`SELECT id FROM dining_tables WHERE shop_id = $1 AND active`, [shopId]);
    const currentIds = new Set(current.map((r: { id: number }) => Number(r.id)));
    for (const t of p.tables) {
      if (t.id && !currentIds.has(t.id)) throw new AppError(409, 'TABLE_GONE', 'A table on this plan was removed meanwhile. Reload and try again.');
    }
    const keep = p.tables.flatMap((t) => (t.id ? [t.id] : []));
    await c.query(`UPDATE dining_tables SET active = false, updated_at = now() WHERE shop_id = $1 AND active AND NOT (id = ANY($2::bigint[]))`, [
      shopId,
      keep,
    ]);
    // Free every kept label first, so swapping two tables' names doesn't trip the unique index.
    await c.query(`UPDATE dining_tables SET label = '~' || id WHERE shop_id = $1 AND id = ANY($2::bigint[])`, [shopId, keep]);
    for (const t of p.tables) {
      const values = [shopId, t.label, t.seats, t.shape, t.x, t.y, t.w, t.h, t.rotation];
      if (t.id) {
        await c.query(
          `UPDATE dining_tables SET label = $2, seats = $3, shape = $4, x = $5, y = $6, w = $7, h = $8, rotation = $9, updated_at = now()
           WHERE shop_id = $1 AND id = $10`,
          [...values, t.id],
        );
      } else {
        await c.query(
          `INSERT INTO dining_tables (shop_id, label, seats, shape, x, y, w, h, rotation, qr_token) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [...values, newToken()],
        );
      }
    }
    await c.query(`UPDATE floor_plans SET width = $2, height = $3, decor = $4, updated_by = $5, updated_at = now() WHERE shop_id = $1`, [
      shopId,
      p.width,
      p.height,
      JSON.stringify(p.decor),
      userId,
    ]);
  });
  return getFloorPlan(pool, shopId);
}

export async function setLocked(shopId: number, userId: number, value: boolean) {
  await pool.query(
    `INSERT INTO floor_plans (shop_id, locked, updated_by) VALUES ($1, $2, $3)
     ON CONFLICT (shop_id) DO UPDATE SET locked = $2, updated_by = $3, updated_at = now()`,
    [shopId, value, userId],
  );
  return getFloorPlan(pool, shopId);
}

export async function newTableQr(shopId: number, tableId: number) {
  const { rowCount } = await pool.query(`UPDATE dining_tables SET qr_token = $3, updated_at = now() WHERE shop_id = $1 AND id = $2 AND active`, [
    shopId,
    tableId,
    newToken(),
  ]);
  if (!rowCount) throw notFound('Table');
  return getFloorPlan(pool, shopId);
}

// ---------------------------------------------------------------------------------------------
// Live floor and kitchen
// ---------------------------------------------------------------------------------------------

/** A table order still needs attention while the kitchen hasn't served it or it isn't fully paid. */
const ACTIVE = `o.status <> 'cancelled' AND (o.kitchen_status <> 'served' OR o.amount_paid_paise < o.total_paise)`;

export interface KitchenOrder {
  id: number;
  orderNumber: string;
  tableId: number | null;
  tableLabel: string | null;
  guestName: string | null;
  notes: string | null;
  kitchenStatus: KitchenStatus;
  kitchenUpdatedAt: string;
  createdAt: string;
  totalPaise: number;
  amountPaidPaise: number;
  paymentStatus: 'unpaid' | 'partial' | 'paid';
  items: { itemName: string; quantity: string }[];
}

const KITCHEN_COLS = `o.id, o.order_number AS "orderNumber", o.table_id AS "tableId", o.table_label AS "tableLabel",
  o.guest_name AS "guestName", o.notes, o.kitchen_status AS "kitchenStatus", o.kitchen_updated_at AS "kitchenUpdatedAt",
  o.created_at AS "createdAt", o.total_paise AS "totalPaise", o.amount_paid_paise AS "amountPaidPaise", o.payment_status AS "paymentStatus",
  COALESCE((SELECT json_agg(json_build_object('itemName', oi.item_name, 'quantity', oi.quantity) ORDER BY oi.position)
            FROM order_items oi WHERE oi.order_id = o.id), '[]') AS items`;

/** Everything the kitchen still has to make, plus what was served in the last 30 minutes (to undo a slip). */
export async function kitchenOrders(shopId: number): Promise<KitchenOrder[]> {
  const { rows } = await pool.query(
    `SELECT ${KITCHEN_COLS} FROM orders o
     WHERE o.shop_id = $1 AND o.kitchen_status IS NOT NULL AND o.status <> 'cancelled'
       AND (o.kitchen_status <> 'served' OR o.kitchen_updated_at > now() - interval '30 minutes')
     ORDER BY o.created_at, o.id
     LIMIT 300`,
    [shopId],
  );
  return rows;
}

/** Tables with their unfinished orders, for the live floor view. */
export async function liveFloor(shopId: number) {
  const plan = await getFloorPlan(pool, shopId);
  const { rows } = await pool.query(
    `SELECT ${KITCHEN_COLS} FROM orders o
     WHERE o.shop_id = $1 AND o.table_id IS NOT NULL AND o.kitchen_status IS NOT NULL AND ${ACTIVE}
     ORDER BY o.created_at, o.id`,
    [shopId],
  );
  return { ...plan, orders: rows as KitchenOrder[] };
}

/** Served and fully paid: the order is done. Never touches cancelled or already completed orders. */
async function completeIfDone(db: Db, shopId: number, orderId: number) {
  await db.query(
    `UPDATE orders SET status = 'completed', updated_at = now()
     WHERE shop_id = $1 AND id = $2 AND status = 'open' AND kitchen_status = 'served' AND payment_status = 'paid'`,
    [shopId, orderId],
  );
}

async function findKitchenOrder(db: Db, shopId: number, orderId: number) {
  const { rows } = await db.query(
    `SELECT id, status, kitchen_status AS "kitchenStatus", total_paise AS "totalPaise", amount_paid_paise AS "amountPaidPaise"
     FROM orders WHERE shop_id = $1 AND id = $2 AND kitchen_status IS NOT NULL`,
    [shopId, orderId],
  );
  if (!rows[0]) throw notFound('Kitchen order');
  if (rows[0].status === 'cancelled') throw new AppError(409, 'ORDER_CANCELLED', 'This order was cancelled.');
  return rows[0] as { id: number; kitchenStatus: KitchenStatus; totalPaise: number; amountPaidPaise: number };
}

export async function setKitchenStatus(shopId: number, orderId: number, status: KitchenStatus) {
  await findKitchenOrder(pool, shopId, orderId);
  await pool.query(`UPDATE orders SET kitchen_status = $3, kitchen_updated_at = now() WHERE shop_id = $1 AND id = $2`, [shopId, orderId, status]);
  await completeIfDone(pool, shopId, orderId);
}

/** Records the remaining balance as one payment (through the normal ledger, so a receipt is issued). */
export async function markPaid(shopId: number, userId: number, orderId: number, method: Exclude<PaymentMethod, 'unrecorded'>) {
  const o = await findKitchenOrder(pool, shopId, orderId);
  const due = o.totalPaise - o.amountPaidPaise;
  if (due > 0) {
    await recordEntry(shopId, userId, orderId, { kind: 'payment', amount: due, method, reference: null, note: 'Paid at the table' });
  }
  await completeIfDone(pool, shopId, orderId);
}

// ---------------------------------------------------------------------------------------------
// Guests (public, by QR token)
// ---------------------------------------------------------------------------------------------

export async function findTableByToken(db: Db, token: string) {
  const { rows } = await db.query(
    `SELECT t.id, t.shop_id AS "shopId", t.label FROM dining_tables t WHERE t.qr_token = $1 AND t.active`,
    [token],
  );
  return (rows[0] as { id: number; shopId: number; label: string } | undefined) ?? null;
}

export async function placeGuestOrder(
  token: string,
  input: { items: { productId: number; quantity: number }[]; name: string | null; note: string | null; paid: boolean; idempotencyKey: string },
) {
  const table = await findTableByToken(pool, token);
  if (!table) throw notFound('Table');

  // Same item twice -> one line.
  const qty = new Map<number, number>();
  for (const it of input.items) qty.set(it.productId, (qty.get(it.productId) ?? 0) + it.quantity);
  const { rows: products } = await pool.query(
    `SELECT id, name, price_paise AS "pricePaise" FROM products WHERE shop_id = $1 AND active AND id = ANY($2::bigint[])`,
    [table.shopId, [...qty.keys()]],
  );
  if (products.length !== qty.size) {
    throw new AppError(409, 'ITEM_UNAVAILABLE', 'Some items in your order are no longer on the menu. Please refresh and try again.');
  }
  const items = products.map((p: { id: number; name: string; pricePaise: number }) => ({
    itemName: p.name,
    quantity: qty.get(Number(p.id))! * 1000,
    unitPrice: Number(p.pricePaise),
    productId: Number(p.id),
  }));
  const total = items.reduce((s, l) => s + l.quantity / 1000 * l.unitPrice, 0);

  const guestToken = newToken();
  const { order, created } = await createOrder(
    table.shopId,
    null,
    {
      walkIn: true,
      items,
      discount: 0,
      notes: input.note,
      amountPaid: input.paid ? total : 0,
      paymentMethod: 'upi',
      idempotencyKey: input.idempotencyKey,
    },
    { tableId: table.id, tableLabel: table.label, guestName: input.name, guestToken },
  );
  // A retried submission returns the order placed the first time (with its own token).
  if (!created) {
    const { rows } = await pool.query(`SELECT guest_token AS t FROM orders WHERE id = $1`, [order.id]);
    return rows[0].t as string;
  }
  return guestToken;
}

export async function guestOrderView(guestToken: string) {
  const { rows } = await pool.query(
    `SELECT ${KITCHEN_COLS}, o.status, s.name AS "shopName", s.logo_key AS "logoKey", t.qr_token AS "tableToken"
     FROM orders o JOIN shops s ON s.id = o.shop_id LEFT JOIN dining_tables t ON t.id = o.table_id AND t.active
     WHERE o.guest_token = $1`,
    [guestToken],
  );
  if (!rows[0]) throw notFound('Order');
  const { items: _short, ...o } = rows[0];
  const { rows: items } = await pool.query(
    `SELECT item_name AS "itemName", quantity, unit_price_paise AS "unitPricePaise", line_total_paise AS "lineTotalPaise"
     FROM order_items WHERE order_id = $1 ORDER BY position`,
    [o.id],
  );
  return { ...o, id: undefined, items };
}
