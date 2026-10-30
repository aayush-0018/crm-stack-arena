import { Db } from '../../db/pool';
import { withTransaction } from '../../db/tx';
import { AppError, isUniqueViolation, notFound } from '../../lib/errors';
import * as repo from './products.repo';
import { StockEntryInput } from './products.schemas';

/** 2500 milli-units of kg -> "2.5 kg" */
export const fmtQty = (milli: number, unit: string) => `${Number((milli / 1000).toFixed(3))} ${unit}`;

interface Shortage {
  productId: number;
  name: string;
  availableMilli: number;
  neededMilli: number;
  unit: string;
}

const insufficient = (items: Shortage[]) =>
  new AppError(
    409,
    'INSUFFICIENT_STOCK',
    `Not enough stock: ${items.map((s) => `${s.name} (${fmtQty(Math.max(0, s.availableMilli), s.unit)} left, ${fmtQty(s.neededMilli, s.unit)} needed)`).join('; ')}`,
    { items },
  );

/**
 * Makes an order's stock movements match the order: posts the difference between what its tracked
 * product lines need now and what has already been taken. Covers create, edit, cancel (needs
 * nothing), reopen and delete (`removing`). Call inside the order's transaction.
 */
export async function syncOrderStock(c: Db, shopId: number, orderId: number, userId: number, { removing = false, why = '' } = {}) {
  const { rows: ord } = await c.query(`SELECT status, order_number AS "orderNumber" FROM orders WHERE shop_id = $1 AND id = $2`, [shopId, orderId]);
  if (!ord[0]) throw notFound('Order');
  const needsStock = !removing && ord[0].status !== 'cancelled';

  const { rows: wanted } = needsStock
    ? await c.query(
        `SELECT oi.product_id AS id, sum((oi.quantity * 1000)::bigint)::bigint AS qty
         FROM order_items oi JOIN products p ON p.id = oi.product_id
         WHERE oi.order_id = $1 AND p.track_stock GROUP BY oi.product_id`,
        [orderId],
      )
    : { rows: [] as { id: number; qty: number }[] };
  const { rows: taken } = await c.query(
    `SELECT m.product_id AS id, (-sum(m.qty_milli))::bigint AS qty
     FROM stock_movements m JOIN products p ON p.id = m.product_id
     WHERE m.order_id = $1 AND m.kind IN ('sale', 'sale_reversal') AND p.track_stock GROUP BY m.product_id`,
    [orderId],
  );

  const diff = new Map<number, number>();
  for (const r of wanted) diff.set(r.id, (diff.get(r.id) ?? 0) + r.qty);
  for (const r of taken) diff.set(r.id, (diff.get(r.id) ?? 0) - r.qty);
  const changes = [...diff].filter(([, d]) => d !== 0);
  if (!changes.length) return;

  const stock = await repo.lockStock(c, shopId, changes.map(([id]) => id));
  if (!(await repo.allowNegativeStock(c, shopId))) {
    const short = changes
      .filter(([id, d]) => d > 0 && stock.get(id)!.stockMilli - d < 0)
      .map(([id, d]) => {
        const s = stock.get(id)!;
        return { productId: id, name: s.name, unit: s.unit, availableMilli: s.stockMilli, neededMilli: d };
      });
    if (short.length) throw insufficient(short);
  }
  const label = `${ord[0].orderNumber}${why ? ` ${why}` : ''}`;
  for (const [productId, d] of changes) {
    await repo.insertMovement(c, {
      shopId,
      productId,
      kind: d > 0 ? 'sale' : 'sale_reversal',
      qtyMilli: -d,
      orderId: removing ? null : orderId,
      note: label,
      userId,
    });
  }
}

/** Stock received, written off, or counted (stocktake). */
export async function recordStockEntry(shopId: number, userId: number, productId: number, input: StockEntryInput) {
  try {
    return await withTransaction(async (c) => {
      const product = await repo.findProduct(c, shopId, productId);
      if (!product) throw notFound('Product');
      if (!product.trackStock) throw new AppError(409, 'NOT_TRACKED', 'Stock is not tracked for this product. Turn on stock tracking first.');
      const current = (await repo.lockStock(c, shopId, [productId])).get(productId)!.stockMilli;

      let qty: number;
      if (input.kind === 'receipt') qty = input.qty;
      else if (input.kind === 'write_off') qty = -input.qty;
      else qty = input.qty - current; // stocktake: record the difference from what was counted

      if (input.kind !== 'stocktake' && input.qty === 0) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Enter a quantity more than 0', { qty: 'Enter a quantity more than 0' });
      }
      if (input.kind === 'write_off' && current + qty < 0 && !(await repo.allowNegativeStock(c, shopId))) {
        throw new AppError(400, 'VALIDATION_ERROR', `Only ${fmtQty(Math.max(0, current), product.unit)} in stock`, {
          qty: `Only ${fmtQty(Math.max(0, current), product.unit)} in stock`,
        });
      }
      if (qty !== 0) {
        await repo.insertMovement(c, { shopId, productId, kind: input.kind, qtyMilli: qty, note: input.note, idempotencyKey: input.idempotencyKey, userId });
      }
      return { changed: qty !== 0 };
    });
  } catch (err) {
    if (input.idempotencyKey && isUniqueViolation(err, 'stock_movements_idem_uq')) return { changed: false };
    throw err;
  }
}

/** Throws unless every id is a product of this shop. */
export async function assertShopProducts(c: Db, shopId: number, ids: number[]) {
  const unique = [...new Set(ids)];
  if (!unique.length) return;
  const { rows } = await c.query(`SELECT id FROM products WHERE shop_id = $1 AND id = ANY($2::bigint[])`, [shopId, unique]);
  if (rows.length !== unique.length) {
    throw new AppError(400, 'VALIDATION_ERROR', 'One of the items is not a product of this shop', { items: 'Unknown product' });
  }
}

