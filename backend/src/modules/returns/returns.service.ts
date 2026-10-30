import { Db, pool } from '../../db/pool';
import { withTransaction } from '../../db/tx';
import { AppError, isUniqueViolation, notFound } from '../../lib/errors';
import { lineTotalPaise, quantityToMilli } from '../../lib/money';
import { branchCode, formatDocNumber, nextSeq, todayIST } from '../../lib/numbering';
import { findCustomer } from '../customers/customers.repo';
import { latestInvoiceForOrder } from '../invoices/invoices.repo';
import { completeIfSettled, findItems, findOrder } from '../orders/orders.repo';
import { derivePaymentStatus } from '../orders/totals';
import { netPaid } from '../payments/payments.repo';
import { PaymentMethod } from '../payments/payments.schemas';
import { addEntry } from '../payments/payments.service';
import { fmtQty } from '../products/stock.service';
import { insertMovement } from '../products/products.repo';
import { findShop } from '../shop/shop.repo';
import { ReturnCondition, ReturnInput } from './returns.schemas';

const invalid = (field: string, message: string) => new AppError(400, 'VALIDATION_ERROR', message, { [field]: message });

/** round(a × b / c), half-up, exact for paise. */
const mulDivHalfUp = (a: number, b: number, c: number) => Number((2n * BigInt(a) * BigInt(b) + BigInt(c)) / (2n * BigInt(c)));

export interface ReturnLinePlan {
  position: number;
  itemName: string;
  productId: number | null;
  quantityMilli: number;
  unitPricePaise: number;
  grossPaise: number;
  valuePaise: number;
  condition: ReturnCondition;
}

/** True once any items have been returned on the order. */
export async function orderHasReturns(db: Db, orderId: number) {
  const { rows } = await db.query(`SELECT 1 FROM order_returns WHERE order_id = $1 LIMIT 1`, [orderId]);
  return rows.length > 0;
}

export const hasReturnsError = () =>
  new AppError(409, 'ORDER_HAS_RETURNS', 'Items on this order have been returned, so it can no longer be edited, cancelled or deleted. Use another return for anything else coming back.');

/** Milli-units already returned per order line position. */
async function returnedByPosition(db: Db, orderId: number) {
  const { rows } = await db.query(
    `SELECT ri.position, sum((ri.quantity * 1000)::bigint)::bigint AS milli
     FROM order_return_items ri JOIN order_returns r ON r.id = ri.return_id WHERE r.order_id = $1 GROUP BY ri.position`,
    [orderId],
  );
  return new Map<number, number>(rows.map((r) => [r.position, r.milli]));
}

/**
 * Where refunded money goes back to: the methods the customer paid with (net of earlier refunds),
 * most recent payment first.
 */
async function refundsToOriginalMethods(db: Db, orderId: number, amount: number) {
  const { rows } = await db.query(
    `SELECT method, sum(CASE WHEN kind = 'payment' THEN amount_paise ELSE -amount_paise END)::bigint AS net
     FROM payments WHERE order_id = $1 AND voided_at IS NULL
     GROUP BY method HAVING sum(CASE WHEN kind = 'payment' THEN amount_paise ELSE -amount_paise END) > 0
     ORDER BY max(id) FILTER (WHERE kind = 'payment') DESC NULLS LAST`,
    [orderId],
  );
  const out: { method: PaymentMethod; amountPaise: number }[] = [];
  let left = amount;
  for (const r of rows) {
    if (left <= 0) break;
    const take = Math.min(left, r.net);
    out.push({ method: r.method, amountPaise: take });
    left -= take;
  }
  // Can't happen while paid = ledger, but never refund less than is owed back.
  if (left > 0) out.push({ method: rows[0]?.method ?? 'cash', amountPaise: left });
  return out;
}

/**
 * Returns items from an order. The order's total goes down by the items' value (after their share of
 * the order discount), which first reduces what is still owed; anything paid beyond the new total is
 * refunded. Saleable items go back into stock; damaged ones don't. The order's items and every invoice
 * snapshot stay exactly as they were. `dryRun` previews without saving.
 */
export async function createReturn(shopId: number, userId: number, orderId: number, input: ReturnInput) {
  if (!input.dryRun && input.idempotencyKey) {
    const seen = await findReturnIdByKey(pool, shopId, input.idempotencyKey);
    if (seen) return { created: false, return: await getReturn(shopId, seen) };
  }
  try {
    const result = await withTransaction(async (c) => {
      const order = await findOrder(c, shopId, orderId, { forUpdate: true });
      if (!order) throw notFound('Order');
      if (!input.dryRun && input.idempotencyKey) {
        const seen = await findReturnIdByKey(c, shopId, input.idempotencyKey);
        if (seen) return { type: 'existing' as const, id: seen };
      }
      if (order.status === 'cancelled') throw new AppError(409, 'ORDER_CANCELLED', 'This order is cancelled. A cancelled order can’t take returns.');
      const today = await todayIST(c);
      const returnDate = input.returnDate ?? today;
      if (returnDate > today) throw invalid('returnDate', 'The date can’t be in the future');
      if (returnDate < order.orderDate) throw invalid('returnDate', 'The return can’t be before the order date');

      const items = await findItems(c, orderId);
      const returned = await returnedByPosition(c, orderId);
      const asked = new Map<number, number>();
      const lines: ReturnLinePlan[] = input.items.map((l, i) => {
        const item = items.find((it) => it.position === l.position);
        if (!item) throw invalid(`items.${i}.position`, 'Not an item on this order');
        const sold = quantityToMilli(String(item.quantity));
        const before = (returned.get(l.position) ?? 0) + (asked.get(l.position) ?? 0);
        if (before + l.quantity > sold) {
          throw invalid(`items.${i}.quantity`, `Only ${fmtQty(Math.max(0, sold - before), '').trim()} of ${item.itemName} left to return`);
        }
        asked.set(l.position, (asked.get(l.position) ?? 0) + l.quantity);
        const gross = lineTotalPaise(l.quantity, item.unitPricePaise);
        const share = order.subtotalPaise > 0 ? mulDivHalfUp(gross, order.discountPaise, order.subtotalPaise) : 0;
        return {
          position: l.position,
          itemName: item.itemName,
          productId: item.productId,
          quantityMilli: l.quantity,
          unitPricePaise: item.unitPricePaise,
          grossPaise: gross,
          valuePaise: gross - share,
          condition: l.condition,
        };
      });

      // Everything left is coming back: the return takes exactly what remains of the total, so
      // rounding across several returns can never leave a paisa behind (the difference goes on the last line).
      const everything = items.every((it) => (returned.get(it.position) ?? 0) + (asked.get(it.position) ?? 0) >= quantityToMilli(String(it.quantity)));
      let value = lines.reduce((s, l) => s + l.valuePaise, 0);
      const target = everything ? order.totalPaise : Math.min(value, order.totalPaise);
      if (target !== value) {
        const last = lines[lines.length - 1];
        last.valuePaise = Math.max(0, last.valuePaise + (target - value));
        value = lines.reduce((s, l) => s + l.valuePaise, 0);
      }
      const newTotal = order.totalPaise - value;
      const refund = Math.max(0, order.amountPaidPaise - newTotal);
      const refunds =
        refund === 0
          ? []
          : input.refundMethod === 'original'
            ? await refundsToOriginalMethods(c, orderId, refund)
            : [{ method: input.refundMethod, amountPaise: refund }];
      const preview = {
        orderId,
        orderNumber: order.orderNumber,
        returnDate,
        valuePaise: value,
        totalBeforePaise: order.totalPaise,
        totalAfterPaise: newTotal,
        paidBeforePaise: order.amountPaidPaise,
        refundPaise: refund,
        dueAfterPaise: newTotal - (order.amountPaidPaise - refund),
        refunds,
        lines: lines.map((l) => ({ ...l, quantity: l.quantityMilli / 1000 })),
      };
      if (input.dryRun) return { type: 'preview' as const, preview };

      const returnNumber = formatDocNumber('RTN', returnDate.slice(0, 4), await nextSeq(c, shopId, 'return'), await branchCode(c, shopId));
      const { rows } = await c.query(
        `INSERT INTO order_returns (shop_id, order_id, return_number, return_date, reason, value_paise, refund_paise, idempotency_key, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [shopId, orderId, returnNumber, returnDate, input.reason, value, refund, input.idempotencyKey ?? null, userId],
      );
      const returnId: number = rows[0].id;
      for (const l of lines) {
        await c.query(
          `INSERT INTO order_return_items (return_id, position, item_name, product_id, quantity, unit_price_paise, gross_paise, value_paise, condition)
           VALUES ($1, $2, $3, $4, $5::numeric / 1000, $6, $7, $8, $9)`,
          [returnId, l.position, l.itemName, l.productId, l.quantityMilli, l.unitPricePaise, l.grossPaise, l.valuePaise, l.condition],
        );
      }

      // Saleable items of stock-tracked products go back on the shelf; damaged ones stay out.
      const restock = new Map<number, number>();
      for (const l of lines) if (l.condition === 'saleable' && l.productId) restock.set(l.productId, (restock.get(l.productId) ?? 0) + l.quantityMilli);
      if (restock.size) {
        const { rows: tracked } = await c.query(`SELECT id FROM products WHERE shop_id = $1 AND id = ANY($2::bigint[]) AND track_stock ORDER BY id FOR UPDATE`, [shopId, [...restock.keys()]]);
        for (const p of tracked) {
          await insertMovement(c, { shopId, productId: p.id, kind: 'return', qtyMilli: restock.get(p.id)!, orderId, note: `${returnNumber} (${order.orderNumber})`, userId });
        }
      }

      for (const r of refunds) {
        await addEntry(c, {
          shopId,
          orderId,
          userId,
          kind: 'refund',
          amountPaise: r.amountPaise,
          method: r.method,
          paidOn: returnDate,
          reference: returnNumber,
          note: `Refund for return ${returnNumber}`,
          returnId,
        });
      }
      // One statement, so the totals and paid amount move together within every CHECK.
      const paid = await netPaid(c, orderId);
      await c.query(
        `UPDATE orders SET returned_paise = returned_paise + $3, total_paise = total_paise - $3,
           amount_paid_paise = $4, payment_status = $5, updated_at = now()
         WHERE shop_id = $1 AND id = $2`,
        [shopId, orderId, value, paid, derivePaymentStatus(paid, newTotal)],
      );
      await completeIfSettled(c, shopId, orderId);
      return { type: 'created' as const, id: returnId };
    });
    if (result.type === 'preview') return { preview: result.preview };
    return { created: result.type === 'created', return: await getReturn(shopId, result.id) };
  } catch (err) {
    if (input.idempotencyKey && isUniqueViolation(err, 'order_returns_shop_idem_uq')) {
      const seen = await findReturnIdByKey(pool, shopId, input.idempotencyKey);
      if (seen) return { created: false, return: await getReturn(shopId, seen) };
    }
    throw err;
  }
}

async function findReturnIdByKey(db: Db, shopId: number, key: string): Promise<number | null> {
  const { rows } = await db.query(`SELECT id FROM order_returns WHERE shop_id = $1 AND idempotency_key = $2`, [shopId, key]);
  return rows[0]?.id ?? null;
}

interface ReturnHeader {
  id: number;
  orderId: number;
  orderNumber: string;
  orderDate: string;
  customerId: number | null;
  returnNumber: string;
  returnDate: string;
  reason: string | null;
  valuePaise: number;
  refundPaise: number;
  createdAt: string;
  createdByName: string | null;
}

const RETURN_COLS = `r.id, r.order_id AS "orderId", o.order_number AS "orderNumber", o.order_date AS "orderDate", o.customer_id AS "customerId",
  r.return_number AS "returnNumber", r.return_date AS "returnDate", r.reason, r.value_paise AS "valuePaise",
  r.refund_paise AS "refundPaise", r.created_at AS "createdAt", u.name AS "createdByName"`;

export interface ReturnItem {
  returnId: number;
  position: number;
  itemName: string;
  productId: number | null;
  quantity: string;
  unitPricePaise: number;
  grossPaise: number;
  valuePaise: number;
  condition: ReturnCondition;
}

export interface ReturnRefund {
  returnId: number;
  id: number;
  amountPaise: number;
  method: PaymentMethod;
  paidOn: string;
  voidedAt: string | null;
  receiptId: number | null;
  receiptNumber: string | null;
}

async function itemsAndRefunds(db: Db, returnIds: number[]): Promise<{ items: ReturnItem[]; refunds: ReturnRefund[] }> {
  const [items, refunds] = await Promise.all([
    db.query(
      `SELECT return_id AS "returnId", position, item_name AS "itemName", product_id AS "productId", quantity,
         unit_price_paise AS "unitPricePaise", gross_paise AS "grossPaise", value_paise AS "valuePaise", condition
       FROM order_return_items WHERE return_id = ANY($1::bigint[]) ORDER BY id`,
      [returnIds],
    ),
    db.query(
      `SELECT p.return_id AS "returnId", p.id, p.amount_paise AS "amountPaise", p.method, p.paid_on AS "paidOn",
         p.voided_at AS "voidedAt", p.receipt_id AS "receiptId", rc.receipt_number AS "receiptNumber"
       FROM payments p LEFT JOIN receipts rc ON rc.id = p.receipt_id WHERE p.return_id = ANY($1::bigint[]) ORDER BY p.id`,
      [returnIds],
    ),
  ]);
  return { items: items.rows, refunds: refunds.rows };
}

/** All returns on an order, oldest first, each with its items and refunds. */
export async function listReturns(db: Db, orderId: number) {
  const { rows } = await db.query(
    `SELECT ${RETURN_COLS} FROM order_returns r JOIN orders o ON o.id = r.order_id LEFT JOIN users u ON u.id = r.created_by
     WHERE r.order_id = $1 ORDER BY r.id`,
    [orderId],
  );
  if (!rows.length) return [];
  const headers = rows as ReturnHeader[];
  const { items, refunds } = await itemsAndRefunds(db, headers.map((r) => r.id));
  return headers.map((r) => ({ ...r, items: items.filter((i) => i.returnId === r.id), refunds: refunds.filter((p) => p.returnId === r.id) }));
}

/** One return adjustment document, with the shop, customer and invoice it refers to. */
export async function getReturn(shopId: number, id: number) {
  const { rows } = await pool.query(
    `SELECT ${RETURN_COLS} FROM order_returns r JOIN orders o ON o.id = r.order_id LEFT JOIN users u ON u.id = r.created_by
     WHERE r.shop_id = $1 AND r.id = $2`,
    [shopId, id],
  );
  if (!rows[0]) throw notFound('Return');
  const r = rows[0] as ReturnHeader;
  const [{ items, refunds }, shop, customer, invoice] = await Promise.all([
    itemsAndRefunds(pool, [id]),
    findShop(pool, shopId),
    r.customerId ? findCustomer(pool, shopId, r.customerId, { includeDeleted: true }) : null,
    latestInvoiceForOrder(pool, r.orderId),
  ]);
  const { id: _id, allowNegativeStock: _s, ...shopDetails } = shop!;
  return {
    ...r,
    items,
    refunds,
    shop: shopDetails,
    customer: customer ? { name: customer.name, phone: customer.phone } : { name: 'Walk-in customer', phone: null },
    invoice: invoice ? { id: invoice.id, invoiceNumber: invoice.invoiceNumber, revision: invoice.revision, status: invoice.status } : null,
  };
}
