import { Db } from '../../db/pool';
import { escapeLike } from '../../lib/validation';
import { normalisePhone } from '../../lib/phone';
import { CustomerInput, ListCustomersQuery } from './customers.schemas';

export interface Customer {
  id: number;
  name: string;
  phone: string;
  email: string | null;
  address: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

const COLS = `c.id, c.name, c.phone, c.email, c.address, c.notes,
  c.created_at AS "createdAt", c.updated_at AS "updatedAt", c.deleted_at AS "deletedAt"`;

const TODAY = `(now() AT TIME ZONE 'Asia/Kolkata')::date`;

/**
 * Per-customer order stats + segment, for every active customer of shop $1.
 *  new       - no orders yet, or first order within 30 days
 *  forgotten - last order 60+ days ago
 *  vip       - top 10% by spend in the last 180 days
 *  active    - everyone else
 */
const SEGMENT_CTE = `
  stats AS (
    SELECT c.id,
      count(o.id) FILTER (WHERE o.status <> 'cancelled')::int AS order_count,
      max(o.order_date) FILTER (WHERE o.status <> 'cancelled') AS last_order,
      min(o.order_date) FILTER (WHERE o.status <> 'cancelled') AS first_order,
      COALESCE(sum(o.total_paise) FILTER (WHERE o.status <> 'cancelled'), 0)::bigint AS spent,
      COALESCE(sum(o.total_paise - o.amount_paid_paise) FILTER (WHERE o.status <> 'cancelled'), 0)::bigint AS due,
      COALESCE(sum(o.total_paise) FILTER (WHERE o.status <> 'cancelled' AND o.order_date > ${TODAY} - 180), 0)::bigint AS spent_180
    FROM customers c LEFT JOIN orders o ON o.customer_id = c.id
    WHERE c.shop_id = $1 AND c.deleted_at IS NULL
    GROUP BY c.id
  ),
  seg AS (
    SELECT s.*, CASE
      WHEN s.order_count = 0 OR s.first_order > ${TODAY} - 30 THEN 'new'
      WHEN s.last_order <= ${TODAY} - 60 THEN 'forgotten'
      WHEN s.spent_180 > 0 AND percent_rank() OVER (ORDER BY s.spent_180) >= 0.9 THEN 'vip'
      ELSE 'active'
    END AS segment
    FROM stats s
  )`;

const SORTS: Record<ListCustomersQuery['sort'], string> = {
  name: 'lower(c.name)',
  created: 'c.created_at',
  lastOrder: 'seg.last_order',
  spent: 'seg.spent',
  orders: 'seg.order_count',
};

export async function listCustomers(db: Db, shopId: number, opts: ListCustomersQuery) {
  const params: unknown[] = [shopId];
  const where: string[] = [];
  if (opts.search) {
    params.push(`%${escapeLike(opts.search.toLowerCase())}%`);
    const nameIdx = params.length;
    const digits = normalisePhone(opts.search);
    params.push(digits ? `%${escapeLike(digits)}%` : `%${escapeLike(opts.search)}%`);
    where.push(`(lower(c.name) LIKE $${nameIdx} OR c.phone LIKE $${params.length})`);
  }
  if (opts.segment) {
    params.push(opts.segment);
    where.push(`seg.segment = $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const from = `FROM customers c JOIN seg ON seg.id = c.id ${whereSql}`;

  const count = await db.query(`WITH ${SEGMENT_CTE} SELECT count(*)::int AS n ${from}`, params);

  params.push(opts.pageSize, (opts.page - 1) * opts.pageSize);
  const dir = opts.dir === 'desc' ? 'DESC' : 'ASC';
  const { rows } = await db.query(
    `WITH ${SEGMENT_CTE}
     SELECT ${COLS}, seg.order_count AS "orderCount", to_char(seg.last_order, 'YYYY-MM-DD') AS "lastOrderDate",
       seg.spent AS "totalSpentPaise", seg.due AS "duePaise", seg.segment
     ${from}
     ORDER BY ${SORTS[opts.sort]} ${dir} NULLS LAST, c.id
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { rows, total: count.rows[0].n as number };
}

/** Numbers for the customers stat strip. */
export async function customersSummary(db: Db, shopId: number) {
  const [counts, gap, trend] = await Promise.all([
    db.query(
      `WITH ${SEGMENT_CTE}
       SELECT count(*)::int AS total,
         count(*) FILTER (WHERE last_order > ${TODAY} - 60)::int AS active,
         count(*) FILTER (WHERE segment = 'forgotten')::int AS forgotten,
         count(*) FILTER (WHERE segment = 'vip')::int AS vip,
         count(*) FILTER (WHERE segment = 'new')::int AS "new",
         count(*) FILTER (WHERE order_count >= 2)::int AS repeaters,
         count(*) FILTER (WHERE order_count >= 1)::int AS buyers
       FROM seg`,
      [shopId],
    ),
    db.query(
      `SELECT COALESCE(avg(gap), 0)::float AS "avgGapDays" FROM (
         SELECT order_date - lag(order_date) OVER (PARTITION BY customer_id ORDER BY order_date) AS gap
         FROM orders WHERE shop_id = $1 AND status <> 'cancelled' AND customer_id IS NOT NULL
       ) g WHERE gap IS NOT NULL`,
      [shopId],
    ),
    db.query(
      `SELECT to_char(${TODAY} - (11 - w) * 7, 'YYYY-MM-DD') AS "weekEnd",
         (SELECT count(*) FROM customers c WHERE c.shop_id = $1 AND c.deleted_at IS NULL
            AND (c.created_at AT TIME ZONE 'Asia/Kolkata')::date <= ${TODAY} - (11 - w) * 7)::int AS total,
         (SELECT count(DISTINCT o.customer_id) FROM orders o WHERE o.shop_id = $1 AND o.status <> 'cancelled'
            AND o.order_date > ${TODAY} - (11 - w) * 7 - 60 AND o.order_date <= ${TODAY} - (11 - w) * 7)::int AS active
       FROM generate_series(0, 11) AS w ORDER BY w`,
      [shopId],
    ),
  ]);
  return { ...counts.rows[0], avgGapDays: gap.rows[0].avgGapDays as number, trend: trend.rows };
}

export async function findCustomer(
  db: Db,
  shopId: number,
  id: number,
  { includeDeleted = false } = {},
): Promise<Customer | null> {
  const { rows } = await db.query(
    `SELECT ${COLS} FROM customers c
     WHERE c.shop_id = $1 AND c.id = $2 ${includeDeleted ? '' : 'AND c.deleted_at IS NULL'}`,
    [shopId, id],
  );
  return rows[0] ?? null;
}

export async function findActiveByPhone(db: Db, shopId: number, phone: string, exceptId?: number) {
  const { rows } = await db.query(
    `SELECT id FROM customers
     WHERE shop_id = $1 AND phone = $2 AND deleted_at IS NULL AND ($3::bigint IS NULL OR id <> $3)`,
    [shopId, phone, exceptId ?? null],
  );
  return (rows[0]?.id as number | undefined) ?? null;
}

export async function insertCustomer(db: Db, shopId: number, input: CustomerInput): Promise<Customer> {
  const { rows } = await db.query(
    `INSERT INTO customers AS c (shop_id, name, phone, email, address, notes)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COLS}`,
    [shopId, input.name, input.phone, input.email, input.address, input.notes],
  );
  return rows[0];
}

export async function updateCustomer(
  db: Db,
  shopId: number,
  id: number,
  input: CustomerInput,
): Promise<Customer | null> {
  const { rows } = await db.query(
    `UPDATE customers AS c SET name = $3, phone = $4, email = $5, address = $6, notes = $7, updated_at = now()
     WHERE c.shop_id = $1 AND c.id = $2 AND c.deleted_at IS NULL
     RETURNING ${COLS}`,
    [shopId, id, input.name, input.phone, input.email, input.address, input.notes],
  );
  return rows[0] ?? null;
}

export async function customerStats(db: Db, shopId: number, id: number) {
  const { rows } = await db.query(
    `SELECT count(*) FILTER (WHERE status <> 'cancelled')::int AS "orderCount",
       count(*)::int AS "allOrderCount",
       COALESCE(sum(total_paise) FILTER (WHERE status <> 'cancelled'), 0)::bigint AS "totalSpentPaise",
       COALESCE(sum(total_paise - amount_paid_paise) FILTER (WHERE status <> 'cancelled'), 0)::bigint AS "outstandingPaise"
     FROM orders WHERE shop_id = $1 AND customer_id = $2`,
    [shopId, id],
  );
  // orderCount matches the list and totals (cancelled excluded); allOrderCount is what deleting affects.
  return rows[0] as { orderCount: number; allOrderCount: number; totalSpentPaise: number; outstandingPaise: number };
}

export async function countOrders(db: Db, shopId: number, id: number): Promise<number> {
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM orders WHERE shop_id = $1 AND customer_id = $2`,
    [shopId, id],
  );
  return rows[0].n;
}

export async function hardDeleteCustomer(db: Db, shopId: number, id: number) {
  await db.query(`DELETE FROM customers WHERE shop_id = $1 AND id = $2`, [shopId, id]);
}

export async function softDeleteCustomer(db: Db, shopId: number, id: number) {
  await db.query(
    `UPDATE customers SET deleted_at = now(), updated_at = now() WHERE shop_id = $1 AND id = $2`,
    [shopId, id],
  );
}
