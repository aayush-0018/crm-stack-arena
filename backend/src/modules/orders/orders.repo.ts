import { Db } from '../../db/pool';
import { escapeLike } from '../../lib/validation';
import { ListOrdersQuery, OrderStatus, PaymentStatus } from './orders.schemas';
import { ComputedLine, ComputedTotals } from './totals';

export interface OrderRow {
  id: number;
  customerId: number;
  orderNumber: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  subtotalPaise: number;
  discountPaise: number;
  totalPaise: number;
  amountPaidPaise: number;
  notes: string | null;
  orderDate: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

const COLS = `o.id, o.customer_id AS "customerId", o.order_number AS "orderNumber", o.status,
  o.payment_status AS "paymentStatus", o.subtotal_paise AS "subtotalPaise",
  o.discount_paise AS "discountPaise", o.total_paise AS "totalPaise",
  o.amount_paid_paise AS "amountPaidPaise", o.notes, o.order_date AS "orderDate",
  o.version, o.created_at AS "createdAt", o.updated_at AS "updatedAt"`;

const ORDER_SORTS: Record<ListOrdersQuery['sort'], (dir: string) => string> = {
  date: (d) => `o.order_date ${d}, o.id ${d}`,
  total: (d) => `o.total_paise ${d}, o.id DESC`,
  number: (d) => `o.id ${d}`,
};

export async function listOrders(db: Db, shopId: number, q: ListOrdersQuery) {
  const params: unknown[] = [shopId];
  const where = ['o.shop_id = $1'];
  const add = (sql: (i: number) => string, value: unknown) => {
    params.push(value);
    where.push(sql(params.length));
  };

  if (q.search) {
    add(
      (i) => `(o.order_number ILIKE $${i} OR lower(cu.name) LIKE lower($${i}) OR cu.phone LIKE $${i})`,
      `%${escapeLike(q.search)}%`,
    );
  }
  if (q.customerId) add((i) => `o.customer_id = $${i}`, q.customerId);
  if (q.status) add((i) => `o.status = $${i}`, q.status);
  if (q.paymentStatus) add((i) => `o.payment_status = $${i}`, q.paymentStatus);
  if (q.from) add((i) => `o.order_date >= $${i}`, q.from);
  if (q.to) add((i) => `o.order_date <= $${i}`, q.to);

  const whereSql = where.join(' AND ');
  const from = `FROM orders o JOIN customers cu ON cu.id = o.customer_id`;

  const count = await db.query(`SELECT count(*)::int AS n ${from} WHERE ${whereSql}`, params);
  params.push(q.pageSize, (q.page - 1) * q.pageSize);
  const { rows } = await db.query(
    `SELECT ${COLS}, cu.name AS "customerName", cu.phone AS "customerPhone",
       (SELECT count(*)::int FROM order_items oi WHERE oi.order_id = o.id) AS "itemCount"
     ${from}
     WHERE ${whereSql}
     ORDER BY ${ORDER_SORTS[q.sort](q.dir === 'asc' ? 'ASC' : 'DESC')}
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { rows, total: count.rows[0].n as number };
}

export async function findOrder(db: Db, shopId: number, id: number, { forUpdate = false } = {}) {
  const { rows } = await db.query(
    `SELECT ${COLS} FROM orders o WHERE o.shop_id = $1 AND o.id = $2 ${forUpdate ? 'FOR UPDATE' : ''}`,
    [shopId, id],
  );
  return (rows[0] as OrderRow | undefined) ?? null;
}

export async function findOrderIdByIdempotencyKey(db: Db, shopId: number, key: string) {
  const { rows } = await db.query(`SELECT id FROM orders WHERE shop_id = $1 AND idempotency_key = $2`, [
    shopId,
    key,
  ]);
  return (rows[0]?.id as number | undefined) ?? null;
}

export async function findItems(db: Db, orderId: number): Promise<ComputedLine[]> {
  const { rows } = await db.query(
    `SELECT position, item_name AS "itemName", quantity, unit,
       unit_price_paise AS "unitPricePaise", line_total_paise AS "lineTotalPaise"
     FROM order_items WHERE order_id = $1 ORDER BY position`,
    [orderId],
  );
  return rows;
}

export async function insertOrder(
  db: Db,
  o: {
    shopId: number;
    customerId: number;
    orderNumber: string;
    totals: ComputedTotals;
    notes: string | null;
    orderDate?: string;
    idempotencyKey?: string;
    createdBy: number;
  },
): Promise<number> {
  const t = o.totals;
  const { rows } = await db.query(
    `INSERT INTO orders (shop_id, customer_id, order_number, payment_status, subtotal_paise, discount_paise,
       total_paise, amount_paid_paise, notes, order_date, idempotency_key, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
       COALESCE($10::date, (now() AT TIME ZONE 'Asia/Kolkata')::date), $11, $12)
     RETURNING id`,
    [
      o.shopId, o.customerId, o.orderNumber, t.paymentStatus, t.subtotalPaise, t.discountPaise,
      t.totalPaise, t.amountPaidPaise, o.notes, o.orderDate ?? null, o.idempotencyKey ?? null, o.createdBy,
    ],
  );
  return rows[0].id;
}

export async function updateOrderTotals(
  db: Db,
  shopId: number,
  id: number,
  t: ComputedTotals,
  notes: string | null,
  orderDate?: string,
) {
  await db.query(
    `UPDATE orders SET payment_status = $3, subtotal_paise = $4, discount_paise = $5, total_paise = $6,
       amount_paid_paise = $7, notes = $8, order_date = COALESCE($9::date, order_date),
       version = version + 1, updated_at = now()
     WHERE shop_id = $1 AND id = $2`,
    [shopId, id, t.paymentStatus, t.subtotalPaise, t.discountPaise, t.totalPaise, t.amountPaidPaise, notes, orderDate ?? null],
  );
}

export async function replaceItems(db: Db, orderId: number, lines: ComputedLine[]) {
  await db.query(`DELETE FROM order_items WHERE order_id = $1`, [orderId]);
  const params: unknown[] = [orderId];
  const values = lines.map((l) => {
    params.push(l.position, l.itemName, l.quantity, l.unit, l.unitPricePaise, l.lineTotalPaise);
    const n = params.length;
    return `($1, $${n - 5}, $${n - 4}, $${n - 3}, $${n - 2}, $${n - 1}, $${n})`;
  });
  await db.query(
    `INSERT INTO order_items (order_id, position, item_name, quantity, unit, unit_price_paise, line_total_paise)
     VALUES ${values.join(', ')}`,
    params,
  );
}

export async function updateStatus(db: Db, shopId: number, id: number, status: OrderStatus) {
  await db.query(`UPDATE orders SET status = $3, updated_at = now() WHERE shop_id = $1 AND id = $2`, [
    shopId,
    id,
    status,
  ]);
}

export async function updatePayment(
  db: Db,
  shopId: number,
  id: number,
  amountPaidPaise: number,
  paymentStatus: PaymentStatus,
) {
  await db.query(
    `UPDATE orders SET amount_paid_paise = $3, payment_status = $4, version = version + 1, updated_at = now()
     WHERE shop_id = $1 AND id = $2`,
    [shopId, id, amountPaidPaise, paymentStatus],
  );
}
