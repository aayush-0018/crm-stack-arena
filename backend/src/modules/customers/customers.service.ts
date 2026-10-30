import { Db, pool } from '../../db/pool';
import { withTransaction } from '../../db/tx';
import { AppError, isUniqueViolation, notFound } from '../../lib/errors';
import * as repo from './customers.repo';
import { CustomerInput } from './customers.schemas';
import { syncOrderStock } from '../products/stock.service';

function phoneExists(existingCustomerId: number) {
  return new AppError(409, 'PHONE_EXISTS', 'A customer with this phone already exists', {
    phone: 'A customer with this phone already exists',
    existingCustomerId,
  });
}

/** Creates a customer using the given connection (works inside an order transaction). */
export async function createCustomer(db: Db, shopId: number, input: CustomerInput) {
  const existing = await repo.findActiveByPhone(db, shopId, input.phone);
  if (existing) throw phoneExists(existing);
  try {
    return await repo.insertCustomer(db, shopId, input);
  } catch (err) {
    if (isUniqueViolation(err, 'customers_shop_phone_uq')) {
      throw phoneExists((await repo.findActiveByPhone(pool, shopId, input.phone)) ?? 0);
    }
    throw err;
  }
}

export async function getCustomer(shopId: number, id: number) {
  const customer = await repo.findCustomer(pool, shopId, id);
  if (!customer) throw notFound('Customer');
  return { ...customer, stats: await repo.customerStats(pool, shopId, id) };
}

export async function updateCustomer(shopId: number, id: number, input: CustomerInput) {
  const existing = await repo.findActiveByPhone(pool, shopId, input.phone, id);
  if (existing) throw phoneExists(existing);
  const updated = await repo.updateCustomer(pool, shopId, id, input);
  if (!updated) throw notFound('Customer');
  return updated;
}

/**
 * Default: no orders -> hard delete; has orders -> archive (soft delete), keeping history and invoices.
 * purge: delete the customer together with all their orders and invoices, permanently.
 */
export async function deleteCustomer(shopId: number, userId: number, id: number, purge = false) {
  return withTransaction(async (c) => {
    const customer = await repo.findCustomer(c, shopId, id);
    if (!customer) throw notFound('Customer');
    const orderCount = await repo.countOrders(c, shopId, id);
    if (purge) {
      // Their orders are deleted as if they never happened, so their stock goes back first.
      const { rows: orders } = await c.query(`SELECT id FROM orders WHERE shop_id = $1 AND customer_id = $2 ORDER BY id FOR UPDATE`, [shopId, id]);
      for (const o of orders) await syncOrderStock(c, shopId, o.id, userId, { removing: true, why: 'deleted with customer' });
      await c.query(
        `DELETE FROM invoices WHERE shop_id = $1 AND order_id IN (SELECT id FROM orders WHERE shop_id = $1 AND customer_id = $2)`,
        [shopId, id],
      );
      await c.query(`DELETE FROM orders WHERE shop_id = $1 AND customer_id = $2`, [shopId, id]);
      await repo.hardDeleteCustomer(c, shopId, id);
      return { deleted: 'hard' as const, orderCount };
    }
    if (orderCount === 0) {
      await repo.hardDeleteCustomer(c, shopId, id);
      return { deleted: 'hard' as const, orderCount };
    }
    await repo.softDeleteCustomer(c, shopId, id);
    return { deleted: 'soft' as const, orderCount };
  });
}
