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
