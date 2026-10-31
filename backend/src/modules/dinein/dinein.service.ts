import { randomBytes } from 'crypto';
import { Db, pool } from '../../db/pool';
import { withTransaction } from '../../db/tx';
import { AppError, notFound } from '../../lib/errors';
import { PaymentMethod } from '../payments/payments.schemas';
import { recordEntry } from '../payments/payments.service';
import { queueBill } from './bills';
import { FloorPlanInput, KitchenStatus } from './dinein.schemas';

export const newToken = () => randomBytes(18).toString('base64url');

export interface DiningTable {
  id: number;
  floorId: number | null;
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

const TABLE_COLS = `id, floor_id AS "floorId", label, seats, shape, x, y, w, h, rotation, qr_token AS "qrToken"`;

/** The branch's floors in order, each with its tables, plus the lock. One empty floor if none was saved yet. */
export async function getFloorPlan(db: Db, shopId: number) {
  const [{ rows: plan }, { rows: floors }, { rows: tables }] = await Promise.all([
    db.query(`SELECT locked, updated_at AS "updatedAt" FROM floor_plans WHERE shop_id = $1`, [shopId]),
    db.query(`SELECT id, name, width, height, decor FROM floors WHERE shop_id = $1 ORDER BY position, id`, [shopId]),
    db.query(`SELECT ${TABLE_COLS} FROM dining_tables WHERE shop_id = $1 AND active ORDER BY id`, [shopId]),
  ]);
  const all = tables as DiningTable[];
  return {
    locked: plan[0]?.locked ?? false,
    updatedAt: plan[0]?.updatedAt ?? null,
    floors: floors.length
      ? floors.map((f: { id: number }) => ({ ...f, id: Number(f.id), tables: all.filter((t) => Number(t.floorId) === Number(f.id)) }))
      : [{ name: 'Ground floor', width: 1200, height: 800, decor: [], tables: [] }],
  };
}

const locked = () => new AppError(409, 'PLAN_LOCKED', 'The floor plan is locked. Unlock it to make changes.');
const gone = (what: string) => new AppError(409, 'PLAN_CHANGED', `A ${what} on this plan was removed meanwhile. Reload and try again.`);

/**
 * Saves every floor at once. Floors and tables keep their ids (so tables keep their QR codes) when
 * moved, renamed or moved to another floor. Tables left out are removed: kept for their orders, but
 * their QR code stops working. Floors left out are deleted along with their blocks.
 */
export async function saveFloorPlan(shopId: number, userId: number, p: FloorPlanInput) {
  await withTransaction(async (c) => {
    await c.query(`INSERT INTO floor_plans (shop_id) VALUES ($1) ON CONFLICT DO NOTHING`, [shopId]);
    const { rows } = await c.query(`SELECT locked FROM floor_plans WHERE shop_id = $1 FOR UPDATE`, [shopId]);
    if (rows[0].locked) throw locked();

    const ids = async (sql: string) => new Set((await c.query(sql, [shopId])).rows.map((r: { id: number }) => Number(r.id)));
    const floorIds = await ids(`SELECT id FROM floors WHERE shop_id = $1`);
    const tableIds = await ids(`SELECT id FROM dining_tables WHERE shop_id = $1 AND active`);
    const tables = p.floors.flatMap((f) => f.tables);
    if (p.floors.some((f) => f.id && !floorIds.has(f.id))) throw gone('floor');
    if (tables.some((t) => t.id && !tableIds.has(t.id))) throw gone('table');

    const keepTables = tables.flatMap((t) => (t.id ? [t.id] : []));
    await c.query(`UPDATE dining_tables SET active = false, updated_at = now() WHERE shop_id = $1 AND active AND NOT (id = ANY($2::bigint[]))`, [
      shopId,
      keepTables,
    ]);
    // Free every kept label first, so swapping two tables' names doesn't trip the unique index.
    await c.query(`UPDATE dining_tables SET label = '~' || id WHERE shop_id = $1 AND id = ANY($2::bigint[])`, [shopId, keepTables]);
    const keepFloors = p.floors.flatMap((f) => (f.id ? [f.id] : []));
    await c.query(`DELETE FROM floors WHERE shop_id = $1 AND NOT (id = ANY($2::bigint[]))`, [shopId, keepFloors]);
    // Same for floor names.
    await c.query(`UPDATE floors SET name = '~' || id WHERE shop_id = $1`, [shopId]);

    for (const [position, f] of p.floors.entries()) {
      const values = [shopId, f.name, position, f.width, f.height, JSON.stringify(f.decor)];
      const floorId = f.id
        ? (await c.query(`UPDATE floors SET name = $2, position = $3, width = $4, height = $5, decor = $6, updated_at = now() WHERE shop_id = $1 AND id = $7 RETURNING id`, [...values, f.id])).rows[0].id
        : (await c.query(`INSERT INTO floors (shop_id, name, position, width, height, decor) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, values)).rows[0].id;
      for (const t of f.tables) {
        const tv = [shopId, t.label, t.seats, t.shape, t.x, t.y, t.w, t.h, t.rotation, floorId];
        if (t.id) {
          await c.query(
            `UPDATE dining_tables SET label = $2, seats = $3, shape = $4, x = $5, y = $6, w = $7, h = $8, rotation = $9, floor_id = $10, updated_at = now()
             WHERE shop_id = $1 AND id = $11`,
            [...tv, t.id],
          );
        } else {
          await c.query(
            `INSERT INTO dining_tables (shop_id, label, seats, shape, x, y, w, h, rotation, floor_id, qr_token)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [...tv, newToken()],
          );
        }
      }
    }
    await c.query(`UPDATE floor_plans SET updated_by = $2, updated_at = now() WHERE shop_id = $1`, [shopId, userId]);
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
  floorName: string | null;
  guestName: string | null;
  discountPaise: number;
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
  o.guest_name AS "guestName", o.notes,
  (SELECT f.name FROM dining_tables dt JOIN floors f ON f.id = dt.floor_id WHERE dt.id = o.table_id) AS "floorName",
  o.discount_paise AS "discountPaise", o.kitchen_status AS "kitchenStatus", o.kitchen_updated_at AS "kitchenUpdatedAt",
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

/**
 * Served and fully paid: the order is done, and its bill is emailed to the guest. Never touches
 * cancelled or already completed orders.
 */
async function completeIfDone(db: Db, shopId: number, orderId: number) {
  const { rowCount } = await db.query(
    `UPDATE orders SET status = 'completed', updated_at = now()
     WHERE shop_id = $1 AND id = $2 AND status = 'open' AND kitchen_status = 'served' AND payment_status = 'paid'`,
    [shopId, orderId],
  );
  if (rowCount) queueBill(shopId, orderId);
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
