import { Db, pool } from '../../db/pool';
import { withTransaction } from '../../db/tx';
import { AppError, isUniqueViolation, notFound } from '../../lib/errors';
import { todayIST } from '../../lib/numbering';
import { completeIfSettled, findOrder, OrderRow, updatePayment } from '../orders/orders.repo';
import { derivePaymentStatus } from '../orders/totals';
import * as repo from './payments.repo';
import { PaymentEntryInput, PaymentKind, PaymentMethod } from './payments.schemas';

const rupees = (paise: number) =>
  `₹${new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(paise / 100)}`;

const invalid = (field: string, message: string) => new AppError(400, 'VALIDATION_ERROR', message, { [field]: message });

/**
 * Recalculates the order's paid total and payment status from the ledger. Call inside the same
 * transaction as any ledger change, with the order row already locked (FOR UPDATE).
 */
export async function syncPaid(c: Db, shopId: number, orderId: number) {
  const order = await findOrder(c, shopId, orderId);
  if (!order) throw notFound('Order');
  const net = await repo.netPaid(c, orderId);
  if (net < 0) throw new AppError(409, 'PAYMENT_CONFLICT', 'Refunds would be more than the payments on this order');
  if (net > order.totalPaise) throw new AppError(409, 'PAYMENT_CONFLICT', 'Payments would be more than the order total');
  await updatePayment(c, shopId, orderId, net, derivePaymentStatus(net, order.totalPaise));
  await completeIfSettled(c, shopId, orderId);
}

/** Adds one ledger row without re-syncing (callers sync once at the end). */
export function addEntry(
  c: Db,
  e: { shopId: number; orderId: number; userId: number; kind: PaymentKind; amountPaise: number; method: PaymentMethod; paidOn: string; reference?: string | null; note?: string | null; idempotencyKey?: string },
) {
  return repo.insertPayment(c, e);
}

/**
 * Brings the ledger to `target` by adding the difference as one entry (method not recorded).
 * Used by the older "total paid so far" API and by order edits that still send an amount paid.
 */
export async function adjustPaidTo(c: Db, shopId: number, order: OrderRow, userId: number, target: number, note: string) {
  const delta = target - order.amountPaidPaise;
  if (delta === 0) return;
  await addEntry(c, {
    shopId,
    orderId: order.id,
    userId,
    kind: delta > 0 ? 'payment' : 'refund',
    amountPaise: Math.abs(delta),
    method: 'unrecorded',
    paidOn: await todayIST(c),
    note,
  });
}

async function lockOrder(c: Db, shopId: number, orderId: number) {
  const order = await findOrder(c, shopId, orderId, { forUpdate: true });
  if (!order) throw notFound('Order');
  return order;
}

/** Records a payment or refund. Retrying with the same idempotency key never adds a second entry. */
export async function recordEntry(shopId: number, userId: number, orderId: number, input: PaymentEntryInput) {
  if (input.idempotencyKey) {
    const seen = await repo.findPaymentIdByIdempotencyKey(pool, shopId, input.idempotencyKey);
    if (seen) {
      if (seen.orderId !== orderId) throw new AppError(409, 'CONFLICT', 'This payment was already recorded on another order');
      return { created: false };
    }
  }
  try {
    await withTransaction(async (c) => {
      const order = await lockOrder(c, shopId, orderId);
      const today = await todayIST(c);
      const paidOn = input.paidOn ?? today;
      if (paidOn > today) throw invalid('paidOn', 'The date can’t be in the future');

      if (input.kind === 'payment') {
        if (order.status === 'cancelled') {
          throw new AppError(409, 'ORDER_CANCELLED', 'This order is cancelled. Reopen it before taking a payment.');
        }
        const due = order.totalPaise - order.amountPaidPaise;
        if (due <= 0) throw invalid('amount', 'Nothing is due on this order');
        if (input.amount > due) throw invalid('amount', `That’s more than the balance due (${rupees(due)})`);
      } else if (input.amount > order.amountPaidPaise) {
        throw invalid('amount', order.amountPaidPaise ? `You can refund at most ${rupees(order.amountPaidPaise)}` : 'Nothing has been paid on this order');
      }

      await addEntry(c, {
        shopId,
        orderId,
        userId,
        kind: input.kind,
        amountPaise: input.amount,
        method: input.method,
        paidOn,
        reference: input.reference,
        note: input.note,
        idempotencyKey: input.idempotencyKey,
      });
      await syncPaid(c, shopId, orderId);
    });
  } catch (err) {
    if (input.idempotencyKey && isUniqueViolation(err, 'payments_shop_idem_uq')) return { created: false };
    throw err;
  }
  return { created: true };
}

/** Voids a mistaken entry. It stays in the history, marked as removed. */
export async function voidEntry(shopId: number, userId: number, orderId: number, paymentId: number, reason: string | null) {
  await withTransaction(async (c) => {
    await lockOrder(c, shopId, orderId);
    const p = await repo.findPayment(c, shopId, orderId, paymentId);
    if (!p) throw notFound('Payment');
    if (p.voidedAt) return;
    await repo.voidPayment(c, paymentId, userId, reason);
    try {
      await syncPaid(c, shopId, orderId);
    } catch (err) {
      if (err instanceof AppError && err.code === 'PAYMENT_CONFLICT') {
        throw new AppError(
          409,
          'PAYMENT_CONFLICT',
          p.kind === 'payment'
            ? 'Removing this payment would leave more refunded than paid. Remove the refund first.'
            : 'Removing this refund would make the payments more than the order total.',
        );
      }
      throw err;
    }
  });
}
