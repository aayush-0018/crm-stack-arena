import { Db } from '../../db/pool';
import { escapeLike } from '../../lib/validation';
import { ListProductsQuery, ProductInput } from './products.schemas';

export interface Product {
  id: number;
  name: string;
  sku: string | null;
  category: string | null;
  unit: string;
  pricePaise: number;
  costPaise: number | null;
  trackStock: boolean;
  lowStockMilli: number | null;
  active: boolean;
  stockMilli: number;
  /** Tracked, and at/below its warning level — or below zero. */
  low: boolean;
  createdAt: string;
  updatedAt: string;
}

// Stock = sum of the product's movements. "low" also catches anything below zero.
const FROM = `FROM products p
  LEFT JOIN (SELECT product_id, sum(qty_milli)::bigint AS qty FROM stock_movements WHERE shop_id = $1 GROUP BY product_id) s
    ON s.product_id = p.id`;
const LOW = `(p.track_stock AND COALESCE(s.qty, 0) <= COALESCE(p.low_stock_milli, -1))`;
const COLS = `p.id, p.name, p.sku, p.category, p.unit, p.price_paise AS "pricePaise", p.cost_paise AS "costPaise",
  p.track_stock AS "trackStock", p.low_stock_milli AS "lowStockMilli", p.active,
  COALESCE(s.qty, 0)::bigint AS "stockMilli", ${LOW} AS low,
  p.created_at AS "createdAt", p.updated_at AS "updatedAt"`;

export async function listProducts(db: Db, shopId: number, q: ListProductsQuery) {
  const params: unknown[] = [shopId];
  const where = ['p.shop_id = $1'];
  if (q.status === 'archived') where.push('NOT p.active');
  else where.push('p.active');
  if (q.status === 'low') where.push(LOW);
  if (q.search) {
    params.push(`%${escapeLike(q.search)}%`);
    const n = params.length;
    where.push(`(p.name ILIKE $${n} OR p.sku ILIKE $${n} OR p.category ILIKE $${n})`);
  }
  const whereSql = where.join(' AND ');
  const count = await db.query(`SELECT count(*)::int AS n ${FROM} WHERE ${whereSql}`, params);
  params.push(q.pageSize, (q.page - 1) * q.pageSize);
  const { rows } = await db.query(
    `SELECT ${COLS} ${FROM} WHERE ${whereSql}
     ORDER BY lower(p.name), p.id LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { rows: rows as Product[], total: count.rows[0].n as number };
}

export async function findProduct(db: Db, shopId: number, id: number): Promise<Product | null> {
  const { rows } = await db.query(`SELECT ${COLS} ${FROM} WHERE p.shop_id = $1 AND p.id = $2`, [shopId, id]);
  return rows[0] ?? null;
}

export async function countLowStock(db: Db, shopId: number): Promise<number> {
  const { rows } = await db.query(`SELECT count(*)::int AS n ${FROM} WHERE p.shop_id = $1 AND p.active AND ${LOW}`, [shopId]);
  return rows[0].n;
}

export async function insertProduct(db: Db, shopId: number, p: ProductInput): Promise<number> {
  const { rows } = await db.query(
    `INSERT INTO products (shop_id, name, sku, category, unit, price_paise, cost_paise, track_stock, low_stock_milli)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [shopId, p.name, p.sku, p.category, p.unit, p.price, p.cost, p.trackStock, p.lowStockAt],
  );
  return rows[0].id;
}

export async function updateProduct(db: Db, shopId: number, id: number, p: ProductInput) {
  const { rowCount } = await db.query(
    `UPDATE products SET name = $3, sku = $4, category = $5, unit = $6, price_paise = $7, cost_paise = $8,
       track_stock = $9, low_stock_milli = $10, updated_at = now()
     WHERE shop_id = $1 AND id = $2`,
    [shopId, id, p.name, p.sku, p.category, p.unit, p.price, p.cost, p.trackStock, p.lowStockAt],
  );
  return (rowCount ?? 0) > 0;
}

export async function setActive(db: Db, shopId: number, id: number, active: boolean) {
  const { rowCount } = await db.query(`UPDATE products SET active = $3, updated_at = now() WHERE shop_id = $1 AND id = $2`, [
    shopId,
    id,
    active,
  ]);
  return (rowCount ?? 0) > 0;
}

export interface Movement {
  id: number;
  kind: string;
  qtyMilli: number;
  balanceMilli: number;
  orderId: number | null;
  orderNumber: string | null;
  note: string | null;
  createdAt: string;
  createdByName: string | null;
}

/** Newest first, each with the running stock level after it. */
export async function listMovements(db: Db, shopId: number, productId: number, limit = 200): Promise<Movement[]> {
  const { rows } = await db.query(
    `SELECT * FROM (
       SELECT m.id, m.kind, m.qty_milli AS "qtyMilli",
         sum(m.qty_milli) OVER (ORDER BY m.created_at, m.id)::bigint AS "balanceMilli",
         m.order_id AS "orderId", o.order_number AS "orderNumber", m.note, m.created_at AS "createdAt", u.name AS "createdByName"
       FROM stock_movements m
       LEFT JOIN orders o ON o.id = m.order_id
       LEFT JOIN users u ON u.id = m.created_by
       WHERE m.shop_id = $1 AND m.product_id = $2
     ) t ORDER BY "createdAt" DESC, id DESC LIMIT $3`,
    [shopId, productId, limit],
  );
  return rows;
}

export async function insertMovement(
  db: Db,
  m: { shopId: number; productId: number; kind: string; qtyMilli: number; orderId?: number | null; note?: string | null; idempotencyKey?: string; userId: number | null },
) {
  await db.query(
    `INSERT INTO stock_movements (shop_id, product_id, kind, qty_milli, order_id, note, idempotency_key, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [m.shopId, m.productId, m.kind, m.qtyMilli, m.orderId ?? null, m.note ?? null, m.idempotencyKey ?? null, m.userId],
  );
}

/** Locks the products (in id order, so concurrent orders can't deadlock) and returns their stock. */
export async function lockStock(db: Db, shopId: number, ids: number[]) {
  if (!ids.length) return new Map<number, { name: string; unit: string; stockMilli: number }>();
  await db.query(`SELECT id FROM products WHERE shop_id = $1 AND id = ANY($2::bigint[]) ORDER BY id FOR UPDATE`, [shopId, ids]);
  const { rows } = await db.query(
    `SELECT p.id, p.name, p.unit, COALESCE(sum(m.qty_milli), 0)::bigint AS "stockMilli"
     FROM products p LEFT JOIN stock_movements m ON m.product_id = p.id
     WHERE p.shop_id = $1 AND p.id = ANY($2::bigint[]) GROUP BY p.id`,
    [shopId, ids],
  );
  return new Map(rows.map((r: { id: number; name: string; unit: string; stockMilli: number }) => [r.id, r]));
}

export async function allowNegativeStock(db: Db, shopId: number): Promise<boolean> {
  const { rows } = await db.query(`SELECT allow_negative_stock AS a FROM shops WHERE id = $1`, [shopId]);
  return !!rows[0]?.a;
}
