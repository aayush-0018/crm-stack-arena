import { pool } from '../../db/pool';
import { withTransaction } from '../../db/tx';
import { AppError, isUniqueViolation, notFound } from '../../lib/errors';
import { branchCode, formatOrderNumber, nextSeq } from '../../lib/numbering';
import { findCustomer } from '../customers/customers.repo';
import { createCustomer } from '../customers/customers.service';
import { latestInvoiceForOrder, voidIssuedInvoice } from '../invoices/invoices.repo';
import * as repo from './orders.repo';
import { CreateOrderInput, OrderStatus, UpdateOrderInput } from './orders.schemas';
import { assertPaidWithinTotal, computeTotals, derivePaymentStatus } from './totals';

const orderCancelled = () =>
  new AppError(409, 'ORDER_CANCELLED', 'This order is cancelled. Reopen it before making changes.');

export async function getOrder(shopId: number, id: number) {
  const order = await repo.findOrder(pool, shopId, id);
  if (!order) throw notFound('Order');
  const [customer, items, invoice] = await Promise.all([
    findCustomer(pool, shopId, order.customerId, { includeDeleted: true }),
    repo.findItems(pool, id),
    latestInvoiceForOrder(pool, id),
  ]);
  return {
    ...order,
    customer,
    items,
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
      let customerId = input.customerId;
      if (input.newCustomer) {
        customerId = (await createCustomer(c, shopId, input.newCustomer)).id;
      } else if (!customerId || !(await findCustomer(c, shopId, customerId))) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Customer not found', {
          customerId: 'Select a valid customer',
        });
      }

      const seq = await nextSeq(c, shopId, 'order');
      const id = await repo.insertOrder(c, {
        shopId,
        customerId: customerId!,
        orderNumber: formatOrderNumber(seq, await branchCode(c, shopId)),
        totals,
        notes: input.notes,
        orderDate: input.orderDate,
        idempotencyKey: input.idempotencyKey,
        createdBy: userId,
      });
      await repo.replaceItems(c, id, totals.lines);
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

export async function updateOrder(shopId: number, id: number, input: UpdateOrderInput) {
  await withTransaction(async (c) => {
    const order = await repo.findOrder(c, shopId, id, { forUpdate: true });
    if (!order) throw notFound('Order');
    if (order.status === 'cancelled') throw orderCancelled();

    const totals = computeTotals(input.items, input.discount, input.amountPaid ?? order.amountPaidPaise);
    await repo.updateOrderTotals(c, shopId, id, totals, input.notes, input.orderDate);
    await repo.replaceItems(c, id, totals.lines);
    await repo.completeIfSettled(c, shopId, id);
  });
  // Issued invoices are never modified here; getOrder reports invoice.outdated.
  return getOrder(shopId, id);
}

/** Deletes an order with its items and every invoice revision for it. */
export async function deleteOrder(shopId: number, id: number) {
  return withTransaction(async (c) => {
    const order = await repo.findOrder(c, shopId, id, { forUpdate: true });
    if (!order) throw notFound('Order');
    // invoices -> orders is RESTRICT, so invoices go first (their share logs cascade).
    const inv = await c.query(`DELETE FROM invoices WHERE shop_id = $1 AND order_id = $2`, [shopId, id]);
    await c.query(`DELETE FROM orders WHERE shop_id = $1 AND id = $2`, [shopId, id]); // items cascade
    return { orderNumber: order.orderNumber, deletedInvoices: inv.rowCount ?? 0 };
  });
}

export async function setStatus(shopId: number, id: number, status: OrderStatus) {
  await withTransaction(async (c) => {
    const order = await repo.findOrder(c, shopId, id, { forUpdate: true });
    if (!order) throw notFound('Order');
    await repo.updateStatus(c, shopId, id, status);
    if (status === 'cancelled') await voidIssuedInvoice(c, id);
  });
  return getOrder(shopId, id);
}

export async function setPayment(shopId: number, id: number, amountPaidPaise: number) {
  await withTransaction(async (c) => {
    const order = await repo.findOrder(c, shopId, id, { forUpdate: true });
    if (!order) throw notFound('Order');
    if (order.status === 'cancelled') throw orderCancelled();
    assertPaidWithinTotal(amountPaidPaise, order.totalPaise);
    await repo.updatePayment(c, shopId, id, amountPaidPaise, derivePaymentStatus(amountPaidPaise, order.totalPaise));
    await repo.completeIfSettled(c, shopId, id);
  });
  return getOrder(shopId, id);
}
