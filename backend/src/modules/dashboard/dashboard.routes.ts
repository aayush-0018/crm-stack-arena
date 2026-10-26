import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool';
import { ah } from '../../lib/asyncHandler';
import { auth } from '../../middleware/auth';

export const dashboardRouter = Router();

dashboardRouter.get(
  '/summary',
  ah(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM customers WHERE shop_id = $1 AND deleted_at IS NULL) AS "customers",
         (SELECT count(*)::int FROM orders WHERE shop_id = $1
            AND order_date = (now() AT TIME ZONE 'Asia/Kolkata')::date) AS "ordersToday",
         (SELECT count(*)::int FROM orders WHERE shop_id = $1 AND status = 'open') AS "openOrders",
         (SELECT count(*)::int FROM orders WHERE shop_id = $1 AND status <> 'cancelled'
            AND payment_status IN ('unpaid', 'partial')) AS "unpaidOrders"`,
      [auth(req).shopId],
    );
    res.json(rows[0]);
  }),
);

const analyticsQuery = z.object({
  days: z.coerce.number().pipe(z.union([z.literal(7), z.literal(30), z.literal(90), z.literal(180)])).default(30),
});

// Window = the last `days` calendar days in IST, including today. Cancelled orders excluded from money.
dashboardRouter.get(
  '/analytics',
  ah(async (req, res) => {
    const { days } = analyticsQuery.parse(req.query);
    const shopId = auth(req).shopId;
    const today = `(now() AT TIME ZONE 'Asia/Kolkata')::date`;
    const params = [shopId, days];

    const [daily, summary, payment, status, customers, items] = await Promise.all([
      pool.query(
        `WITH days AS (
           SELECT generate_series(${today} - ($2::int - 1), ${today}, interval '1 day')::date AS d
         )
         SELECT to_char(days.d, 'YYYY-MM-DD') AS date,
           COALESCE(sum(o.total_paise), 0)::bigint AS "revenuePaise",
           COALESCE(sum(o.amount_paid_paise), 0)::bigint AS "collectedPaise",
           count(o.id)::int AS orders
         FROM days
         LEFT JOIN orders o ON o.shop_id = $1 AND o.order_date = days.d AND o.status <> 'cancelled'
         GROUP BY days.d ORDER BY days.d`,
        params,
      ),
      pool.query(
        `SELECT
           COALESCE(sum(total_paise) FILTER (WHERE order_date > ${today} - $2::int), 0)::bigint AS "revenuePaise",
           count(*) FILTER (WHERE order_date > ${today} - $2::int)::int AS orders,
           COALESCE(sum(amount_paid_paise) FILTER (WHERE order_date > ${today} - $2::int), 0)::bigint AS "collectedPaise",
           COALESCE(sum(total_paise - amount_paid_paise) FILTER (WHERE order_date > ${today} - $2::int), 0)::bigint AS "outstandingPaise",
           COALESCE(sum(total_paise) FILTER (WHERE order_date <= ${today} - $2::int), 0)::bigint AS "prevRevenuePaise",
           count(*) FILTER (WHERE order_date <= ${today} - $2::int)::int AS "prevOrders",
           count(DISTINCT customer_id) FILTER (WHERE order_date > ${today} - $2::int)::int AS "activeCustomers"
         FROM orders
         WHERE shop_id = $1 AND status <> 'cancelled' AND order_date > ${today} - 2 * $2::int`,
        params,
      ),
      pool.query(
        `SELECT payment_status AS status, count(*)::int AS orders,
           COALESCE(sum(total_paise - amount_paid_paise), 0)::bigint AS "duePaise"
         FROM orders
         WHERE shop_id = $1 AND status <> 'cancelled' AND order_date > ${today} - $2::int
         GROUP BY payment_status`,
        params,
      ),
      pool.query(
        `SELECT status, count(*)::int AS orders FROM orders
         WHERE shop_id = $1 AND order_date > ${today} - $2::int GROUP BY status`,
        params,
      ),
      pool.query(
        `SELECT c.id, c.name, count(o.id)::int AS orders, sum(o.total_paise)::bigint AS "revenuePaise"
         FROM orders o JOIN customers c ON c.id = o.customer_id
         WHERE o.shop_id = $1 AND o.status <> 'cancelled' AND o.order_date > ${today} - $2::int
         GROUP BY c.id, c.name ORDER BY "revenuePaise" DESC, c.id LIMIT 5`,
        params,
      ),
      pool.query(
        `SELECT oi.item_name AS name, sum(oi.line_total_paise)::bigint AS "revenuePaise",
           count(DISTINCT oi.order_id)::int AS orders
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
         WHERE o.shop_id = $1 AND o.status <> 'cancelled' AND o.order_date > ${today} - $2::int
         GROUP BY oi.item_name ORDER BY "revenuePaise" DESC, oi.item_name LIMIT 5`,
        params,
      ),
    ]);

    res.json({
      days,
      summary: summary.rows[0],
      daily: daily.rows,
      payment: payment.rows,
      status: status.rows,
      topCustomers: customers.rows,
      topItems: items.rows,
    });
  }),
);

const summaryQuery = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD') });

/**
 * Daily summary for the 24 hours ending at 10 pm IST on `date` (10 pm the day before -> 10 pm),
 * by when things were entered, so a late-night order rolls into the next day's summary instead
 * of being missed. Computed on demand from existing data; nothing is stored.
 */
dashboardRouter.get(
  '/daily-summary',
  ah(async (req, res) => {
    const { date } = summaryQuery.parse(req.query);
    const shopId = auth(req).shopId;
    // $2 = window end (10 pm IST on `date`, never in the future); windows are [end - 1 day, end).
    const win = `
      WITH w AS (
        SELECT LEAST(($2::date + time '22:00') AT TIME ZONE 'Asia/Kolkata', now()) AS e
      ), b AS (SELECT e - interval '1 day' AS s, e, e - interval '2 days' AS ps FROM w)`;
    const p = [shopId, date];

    const [orders, items, customers, invoices, topItems, topCustomer, hours, outstanding, window] = await Promise.all([
      pool.query(
        `${win}
         SELECT
           count(*) FILTER (WHERE o.created_at >= s AND o.status <> 'cancelled')::int AS orders,
           COALESCE(sum(o.total_paise) FILTER (WHERE o.created_at >= s AND o.status <> 'cancelled'), 0)::bigint AS "revenuePaise",
           COALESCE(sum(o.amount_paid_paise) FILTER (WHERE o.created_at >= s AND o.status <> 'cancelled'), 0)::bigint AS "collectedPaise",
           count(*) FILTER (WHERE o.created_at >= s AND o.status <> 'cancelled' AND o.payment_status <> 'paid')::int AS "unpaidOrders",
           count(*) FILTER (WHERE o.created_at >= s AND o.status = 'cancelled')::int AS cancelled,
           count(*) FILTER (WHERE o.created_at < s AND o.status <> 'cancelled')::int AS "prevOrders",
           COALESCE(sum(o.total_paise) FILTER (WHERE o.created_at < s AND o.status <> 'cancelled'), 0)::bigint AS "prevRevenuePaise"
         FROM orders o, b
         WHERE o.shop_id = $1 AND o.created_at >= b.ps AND o.created_at < b.e`,
        p,
      ),
      pool.query(
        `${win}
         SELECT count(*)::int AS lines, COALESCE(sum(oi.quantity), 0)::float AS units
         FROM order_items oi JOIN orders o ON o.id = oi.order_id, b
         WHERE o.shop_id = $1 AND o.status <> 'cancelled' AND o.created_at >= b.s AND o.created_at < b.e`,
        p,
      ),
      pool.query(
        `${win}
         SELECT count(*)::int AS "newCustomers" FROM customers c, b
         WHERE c.shop_id = $1 AND c.deleted_at IS NULL AND c.created_at >= b.s AND c.created_at < b.e`,
        p,
      ),
      pool.query(
        `${win}
         SELECT
           (SELECT count(*) FROM invoices i WHERE i.shop_id = $1 AND i.created_at >= b.s AND i.created_at < b.e)::int AS issued,
           (SELECT count(*) FROM invoice_shares x WHERE x.shop_id = $1 AND x.created_at >= b.s AND x.created_at < b.e)::int AS sent
         FROM b`,
        p,
      ),
      pool.query(
        `${win}
         SELECT oi.item_name AS name, sum(oi.quantity)::float AS units, sum(oi.line_total_paise)::bigint AS "revenuePaise"
         FROM order_items oi JOIN orders o ON o.id = oi.order_id, b
         WHERE o.shop_id = $1 AND o.status <> 'cancelled' AND o.created_at >= b.s AND o.created_at < b.e
         GROUP BY oi.item_name ORDER BY "revenuePaise" DESC, oi.item_name LIMIT 3`,
        p,
      ),
      pool.query(
        `${win}
         SELECT c.id, c.name, count(o.id)::int AS orders, sum(o.total_paise)::bigint AS "spentPaise"
         FROM orders o JOIN customers c ON c.id = o.customer_id, b
         WHERE o.shop_id = $1 AND o.status <> 'cancelled' AND o.created_at >= b.s AND o.created_at < b.e
         GROUP BY c.id, c.name ORDER BY "spentPaise" DESC, c.id LIMIT 1`,
        p,
      ),
      pool.query(
        `${win}
         SELECT extract(hour FROM o.created_at AT TIME ZONE 'Asia/Kolkata')::int AS hour, count(*)::int AS orders
         FROM orders o, b
         WHERE o.shop_id = $1 AND o.status <> 'cancelled' AND o.created_at >= b.s AND o.created_at < b.e
         GROUP BY 1 ORDER BY orders DESC, hour LIMIT 1`,
        p,
      ),
      pool.query(
        `SELECT COALESCE(sum(total_paise - amount_paid_paise), 0)::bigint AS "duePaise",
           count(*) FILTER (WHERE total_paise > amount_paid_paise)::int AS "dueOrders"
         FROM orders WHERE shop_id = $1 AND status <> 'cancelled'`,
        [shopId],
      ),
      pool.query(`${win} SELECT s AS "from", e AS "to" FROM b WHERE $1::bigint IS NOT NULL`, p),
    ]);

    res.json({
      date,
      from: window.rows[0].from,
      to: window.rows[0].to,
      ...orders.rows[0],
      itemLines: items.rows[0].lines,
      unitsSold: items.rows[0].units,
      newCustomers: customers.rows[0].newCustomers,
      invoicesIssued: invoices.rows[0].issued,
      invoicesSent: invoices.rows[0].sent,
      topItems: topItems.rows,
      topCustomer: topCustomer.rows[0] ?? null,
      busiestHour: hours.rows[0] ?? null,
      outstanding: outstanding.rows[0],
    });
  }),
);
