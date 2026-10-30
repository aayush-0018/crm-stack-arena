import { pool } from '../../db/pool';
import { withTransaction } from '../../db/tx';
import { AppError, isUniqueViolation, notFound } from '../../lib/errors';
import { branchCode, formatOrderNumber, nextSeq, todayIST } from '../../lib/numbering';
import { findCustomer } from '../customers/customers.repo';
import { createCustomer } from '../customers/customers.service';
import { latestInvoiceForOrder, voidIssuedInvoice } from '../invoices/invoices.repo';
import { listPayments } from '../payments/payments.repo';
import { PaymentMethod } from '../payments/payments.schemas';
import { addEntry, adjustPaidTo, syncPaid } from '../payments/payments.service';
import { assertShopProducts, syncOrderStock } from '../products/stock.service';
import * as repo from './orders.repo';
import { CreateOrderInput, OrderStatus, UpdateOrderInput } from './orders.schemas';
import { assertPaidWithinTotal, computeTotals } from './totals';

const orderCancelled = () =>
  new AppError(409, 'ORDER_CANCELLED', 'This order is cancelled. Reopen it before making changes.');

export async function getOrder(shopId: number, id: number) {
  const order = await repo.findOrder(pool, shopId, id);
  if (!order) throw notFound('Order');
  const [customer, items, invoice, payments] = await Promise.all([
    order.customerId ? findCustomer(pool, shopId, order.customerId, { includeDeleted: true }) : null, // null = walk-in
    repo.findItems(pool, id),
    latestInvoiceForOrder(pool, id),
    listPayments(pool, id),
  ]);
  return {
    ...order,
    customer,
    items,
    payments,
    invoice: invoice
      ? {
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          revision: invoice.revision,
          status: invoice.status,
          issuedAt: invoice.issuedAt,
          outdated: invoice.status === 'issued' && invoice.orderVersion !== order.version,
        }
      : null,
  };
}

export async function createOrder(shopId: number, userId: number, input: CreateOrderInput) {
  // Retry of an already-saved submission -> return the same order.
  if (input.idempotencyKey) {
    const existing = await repo.findOrderIdByIdempotencyKey(pool, shopId, input.idempotencyKey);
    if (existing) return { order: await getOrder(shopId, existing), created: false };
  }

  const totals = computeTotals(input.items, input.discount, input.amountPaid);

  let orderId: number;
  try {
    orderId = await withTransaction(async (c) => {
      let customerId: number | null = input.customerId ?? null;
      if (input.walkIn) {
        customerId = null;
      } else if (input.newCustomer) {
        customerId = (await createCustomer(c, shopId, input.newCustomer)).id;
      } else if (!customerId || !(await findCustomer(c, shopId, customerId))) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Customer not found', {
          customerId: 'Select a valid customer',
        });
      }

      await assertShopProducts(c, shopId, totals.lines.flatMap((l) => (l.productId ? [l.productId] : [])));
      const seq = await nextSeq(c, shopId, 'order');
      const id = await repo.insertOrder(c, {
        shopId,
        customerId,
        orderNumber: formatOrderNumber(seq, await branchCode(c, shopId)),
        totals,
        notes: input.notes,
        orderDate: input.orderDate,
        idempotencyKey: input.idempotencyKey,
        createdBy: userId,
      });
      await repo.replaceItems(c, id, totals.lines);
      await syncOrderStock(c, shopId, id, userId);
      if (totals.amountPaidPaise > 0) {
        const today = await todayIST(c);
        await addEntry(c, {
          shopId,
          orderId: id,
          userId,
          kind: 'payment',
          amountPaise: totals.amountPaidPaise,
          method: input.paymentMethod ?? 'unrecorded',
          // Back-dated order: paid on its date. Future-dated: the money is received today.
          paidOn: input.orderDate && input.orderDate < today ? input.orderDate : today,
          note: 'Paid when the order was created',
        });
      }
      return id;
    });
  } catch (err) {
    // Two identical submissions raced; the other one won.
    if (input.idempotencyKey && isUniqueViolation(err, 'orders_shop_idem_uq')) {
      const existing = await repo.findOrderIdByIdempotencyKey(pool, shopId, input.idempotencyKey);
      if (existing) return { order: await getOrder(shopId, existing), created: false };
    }
    throw err;
  }

  return { order: await getOrder(shopId, orderId), created: true };
}

export async function updateOrder(shopId: number, userId: number, id: number, input: UpdateOrderInput) {
  await withTransaction(async (c) => {
    const order = await repo.findOrder(c, shopId, id, { forUpdate: true });
    if (!order) throw notFound('Order');
    if (order.status === 'cancelled') throw orderCancelled();

    // Payments live in the ledger. An amount paid sent with an edit (older app versions) is
    // recorded as one adjustment entry; omitting it keeps the payments as they are.
    const paid = input.amountPaid ?? order.amountPaidPaise;
    const totals = computeTotals(input.items, input.discount, paid);
    await assertShopProducts(c, shopId, totals.lines.flatMap((l) => (l.productId ? [l.productId] : [])));
    await adjustPaidTo(c, shopId, order, userId, paid, 'Adjusted while editing the order');
    await repo.updateOrderTotals(c, shopId, id, totals, input.notes, input.orderDate);
    await repo.replaceItems(c, id, totals.lines);
    await syncOrderStock(c, shopId, id, userId, { why: 'edited' });
    await syncPaid(c, shopId, id);
  });
  // Issued invoices are never modified here; getOrder reports invoice.outdated.
  return getOrder(shopId, id);
}

/** Deletes an order with its items and every invoice revision for it. Its stock goes back. */
export async function deleteOrder(shopId: number, userId: number, id: number) {
  return withTransaction(async (c) => {
    const order = await repo.findOrder(c, shopId, id, { forUpdate: true });
    if (!order) throw notFound('Order');
    await syncOrderStock(c, shopId, id, userId, { removing: true, why: 'deleted' });
    // invoices -> orders is RESTRICT, so invoices go first (their share logs cascade).
    const inv = await c.query(`DELETE FROM invoices WHERE shop_id = $1 AND order_id = $2`, [shopId, id]);
    await c.query(`DELETE FROM orders WHERE shop_id = $1 AND id = $2`, [shopId, id]); // items cascade
    return { orderNumber: order.orderNumber, deletedInvoices: inv.rowCount ?? 0 };
  });
}

export async function setStatus(
  shopId: number,
  userId: number,
  id: number,
  status: OrderStatus,
  refund?: { method: PaymentMethod },
) {
  await withTransaction(async (c) => {
    const order = await repo.findOrder(c, shopId, id, { forUpdate: true });
    if (!order) throw notFound('Order');
    await repo.updateStatus(c, shopId, id, status);
    // Cancelling puts the stock back; reopening takes it again (refused if it has run out).
    if (status === 'cancelled' || order.status === 'cancelled') {
      await syncOrderStock(c, shopId, id, userId, { why: status === 'cancelled' ? 'cancelled' : 'reopened' });
    }
    if (status === 'cancelled') {
      await voidIssuedInvoice(c, id);
      if (refund && order.amountPaidPaise > 0) {
        await addEntry(c, {
          shopId,
          orderId: id,
          userId,
          kind: 'refund',
          amountPaise: order.amountPaidPaise,
          method: refund.method,
          paidOn: await todayIST(c),
          note: 'Refunded when the order was cancelled',
        });
        await syncPaid(c, shopId, id);
      }
    }
  });
  return getOrder(shopId, id);
}

/**
 * Older API: sets the total paid so far. Kept so a cached copy of the previous app keeps working;
 * the difference is recorded in the ledger as one entry. New code uses POST /orders/:id/payments.
 */
export async function setPayment(shopId: number, userId: number, id: number, amountPaidPaise: number) {
  await withTransaction(async (c) => {
    const order = await repo.findOrder(c, shopId, id, { forUpdate: true });
    if (!order) throw notFound('Order');
    if (order.status === 'cancelled') throw orderCancelled();
    assertPaidWithinTotal(amountPaidPaise, order.totalPaise);
    await adjustPaidTo(c, shopId, order, userId, amountPaidPaise, 'Total paid updated');
    await syncPaid(c, shopId, id);
  });
  return getOrder(shopId, id);
}
