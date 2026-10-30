import { pool } from '../../db/pool';
import { withTransaction } from '../../db/tx';
import { AppError, isUniqueViolation, notFound } from '../../lib/errors';
import { todayIST } from '../../lib/numbering';
import { findCustomer } from '../customers/customers.repo';
import { findReceiptIdByIdempotencyKey, getReceipt, issueReceipt } from '../receipts/receipts.service';
import { addEntry, syncPaid } from './payments.service';
import { SettleInput } from './payments.schemas';

const rupees = (paise: number) => `₹${new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(paise / 100)}`;
const invalid = (field: string, message: string) => new AppError(400, 'VALIDATION_ERROR', message, { [field]: message });

export interface Allocation {
  orderId: number;
  orderNumber: string;
  orderDate: string;
  duePaise: number;
  allocatePaise: number;
  remainingPaise: number;
}

/** Oldest first (by order date, then order number), never more than each order owes. */
export function allocateOldestFirst(orders: { id: number; orderNumber: string; orderDate: string; duePaise: number }[], amount: number): Allocation[] {
  let left = amount;
  return [...orders]
    .sort((a, b) => (a.orderDate < b.orderDate ? -1 : a.orderDate > b.orderDate ? 1 : a.id - b.id))
    .map((o) => {
      const take = Math.min(left, o.duePaise);
      left -= take;
      return { orderId: o.id, orderNumber: o.orderNumber, orderDate: o.orderDate, duePaise: o.duePaise, allocatePaise: take, remainingPaise: o.duePaise - take };
    });
}

/**
 * One customer payment that settles several orders, oldest unpaid first. A preview (`dryRun`) shows the
 * split without saving. Saving locks the customer's orders, re-checks every balance, and records one
 * ledger entry per order under a single receipt, all in one transaction. A retry with the same
 * idempotency key returns the first receipt instead of collecting twice.
 */
export async function settleDues(shopId: number, userId: number, customerId: number, input: SettleInput, dryRun: boolean) {
  const customer = await findCustomer(pool, shopId, customerId);
  if (!customer) throw notFound('Customer');
  if (!dryRun && input.idempotencyKey) {
    const seen = await findReceiptIdByIdempotencyKey(pool, shopId, input.idempotencyKey);
    if (seen) return { created: false, receipt: await getReceipt(shopId, seen) };
  }

  try {
    const result = await withTransaction(async (c) => {
      const today = await todayIST(c);
      const paidOn = input.paidOn ?? today;
      if (paidOn > today) throw invalid('paidOn', 'The date can’t be in the future');
      // Locked in id order so two settlements (or a settlement and a single payment) can't deadlock.
      const { rows } = await c.query(
        `SELECT id, order_number AS "orderNumber", order_date AS "orderDate", (total_paise - amount_paid_paise)::bigint AS "duePaise"
         FROM orders WHERE shop_id = $1 AND customer_id = $2 AND status <> 'cancelled' AND total_paise > amount_paid_paise
         ORDER BY id ${dryRun ? '' : 'FOR UPDATE'}`,
        [shopId, customerId],
      );
      // An identical request may have committed while we waited for those locks.
      if (!dryRun && input.idempotencyKey) {
        const seen = await findReceiptIdByIdempotencyKey(c, shopId, input.idempotencyKey);
        if (seen) return { type: 'existing' as const, receiptId: seen };
      }
      const totalDue = rows.reduce((s, o) => s + o.duePaise, 0);
      if (!totalDue) throw invalid('amount', `${customer.name} has nothing due`);
      if (input.amount > totalDue) throw invalid('amount', `That’s more than the total due (${rupees(totalDue)})`);
      const allocations = allocateOldestFirst(rows, input.amount);
      const used = allocations.filter((a) => a.allocatePaise > 0);
      if (dryRun) return { type: 'preview' as const, totalDuePaise: totalDue, amountPaise: input.amount, allocations };

      const receipt = await issueReceipt(c, {
        shopId,
        kind: 'payment',
        date: paidOn,
        customerId,
        method: input.method,
        reference: input.reference,
        note: input.note ?? (used.length > 1 ? `Settles ${used.length} orders` : null),
        allocations: used.map((a) => ({ orderId: a.orderId, orderNumber: a.orderNumber, amountPaise: a.allocatePaise })),
        userId,
        idempotencyKey: input.idempotencyKey,
      });
      for (const a of used) {
        await addEntry(c, {
          shopId,
          orderId: a.orderId,
          userId,
          kind: 'payment',
          amountPaise: a.allocatePaise,
          method: input.method,
          paidOn,
          reference: input.reference ?? receipt.receiptNumber,
          note: input.note ?? `Part of ${receipt.receiptNumber}`,
          receiptId: receipt.id,
        });
        await syncPaid(c, shopId, a.orderId);
      }
      return { type: 'created' as const, receiptId: receipt.id };
    });
    if (result.type === 'preview') {
      const { type: _t, ...preview } = result;
      return preview;
    }
    return { created: result.type === 'created', receipt: await getReceipt(shopId, result.receiptId) };
  } catch (err) {
    // Two identical submissions raced; the other one won.
    if (input.idempotencyKey && isUniqueViolation(err, 'receipts_shop_idem_uq')) {
      const seen = await findReceiptIdByIdempotencyKey(pool, shopId, input.idempotencyKey);
      if (seen) return { created: false, receipt: await getReceipt(shopId, seen) };
    }
    throw err;
  }
}
