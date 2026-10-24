import { pool } from '../../db/pool';
import { withTransaction } from '../../db/tx';
import { AppError, isUniqueViolation, notFound } from '../../lib/errors';
import { formatInvoiceNumber, nextSeq, todayIST } from '../../lib/numbering';
import { findCustomer } from '../customers/customers.repo';
import { findItems, findOrder } from '../orders/orders.repo';
import { findShop } from '../shop/shop.repo';
import * as repo from './invoices.repo';

/**
 * Invoice = immutable snapshot of the order at issue time.
 * - none yet                          -> revision 1, new number
 * - issued & order unchanged          -> return existing (no duplicate)
 * - issued & order changed, !reissue  -> 409 INVOICE_OUTDATED
 * - issued & order changed, reissue   -> supersede old, revision+1, same number
 * - only superseded/void revisions    -> revision+1, same number
 */
export async function generateInvoice(shopId: number, userId: number, orderId: number, reissue: boolean) {
  try {
    return await withTransaction(async (c) => {
      const order = await findOrder(c, shopId, orderId, { forUpdate: true });
      if (!order) throw notFound('Order');
      if (order.status === 'cancelled') {
        throw new AppError(409, 'ORDER_CANCELLED', 'Cannot generate an invoice for a cancelled order');
      }

      const latest = await repo.latestInvoiceForOrder(c, orderId);
      if (latest?.status === 'issued') {
        if (latest.orderVersion === order.version) return { id: latest.id, created: false };
        if (!reissue) {
          throw new AppError(409, 'INVOICE_OUTDATED', 'This order changed after its invoice was issued', {
            invoiceId: latest.id,
            invoiceNumber: latest.invoiceNumber,
            nextRevision: latest.revision + 1,
          });
        }
        await repo.setInvoiceStatus(c, latest.id, 'superseded');
      }

      const invoiceDate = await todayIST(c);
      const invoiceNumber = latest
        ? latest.invoiceNumber
        : formatInvoiceNumber(invoiceDate.slice(0, 4), await nextSeq(c, shopId, 'invoice'));

      // Sequential: a single transaction client runs one query at a time.
      const shop = await findShop(c, shopId);
      const customer = await findCustomer(c, shopId, order.customerId, { includeDeleted: true });
      const items = await findItems(c, orderId);
      if (!shop || !customer) throw new Error('Shop or customer missing for invoice');

      const { id: _shopId, ...shopSnapshot } = shop;
      const id = await repo.insertInvoice(c, {
        shopId,
        orderId,
        invoiceNumber,
        revision: latest ? latest.revision + 1 : 1,
        orderVersion: order.version,
        invoiceDate,
        shopSnapshot,
        customerSnapshot: {
          name: customer.name,
          phone: customer.phone,
          email: customer.email,
          address: customer.address,
        },
        orderSnapshot: {
          orderNumber: order.orderNumber,
          orderDate: order.orderDate,
          status: order.status,
          notes: order.notes,
        },
        itemsSnapshot: items,
        subtotalPaise: order.subtotalPaise,
        discountPaise: order.discountPaise,
        totalPaise: order.totalPaise,
        amountPaidPaise: order.amountPaidPaise,
        paymentStatus: order.paymentStatus,
        createdBy: userId,
      });
      return { id, created: true };
    });
  } catch (err) {
    // Backstop for the one-issued-invoice-per-order index.
    if (isUniqueViolation(err, 'invoices_one_issued_per_order')) {
      const latest = await repo.latestInvoiceForOrder(pool, orderId);
      if (latest) return { id: latest.id, created: false };
    }
    throw err;
  }
}

export async function getInvoice(shopId: number, id: number) {
  const invoice = await repo.findInvoice(pool, shopId, id);
  if (!invoice) throw notFound('Invoice');
  return invoice;
}
