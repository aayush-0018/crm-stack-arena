import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool';
import { ah } from '../../lib/asyncHandler';
import { AppError } from '../../lib/errors';
import { todayIST } from '../../lib/numbering';
import { dateInput } from '../../lib/validation';
import { auth } from '../../middleware/auth';

export const reportsRouter = Router();

const rangeQuery = z.object({ from: dateInput.optional(), to: dateInput.optional() });

/** Ageing buckets by days since the order date (there are no due dates in CartWell). */
export const AGEING_BUCKETS = ['0-30', '31-60', '61-90', '90+'] as const;
type Bucket = (typeof AGEING_BUCKETS)[number];
export const bucketFor = (ageDays: number): Bucket => (ageDays <= 30 ? '0-30' : ageDays <= 60 ? '31-60' : ageDays <= 90 ? '61-90' : '90+');
const emptyBuckets = (): Record<Bucket, number> => ({ '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 });

/**
 * Outstanding and ageing, as of today. An order is outstanding when it isn't cancelled and its
 * balance (total − paid) is above zero. Age = today − order date (a future-dated order is 0 days old).
 * `from`/`to` filter by order date.
 */
reportsRouter.get(
  '/ageing',
  ah(async (req, res) => {
    const shopId = auth(req).shopId;
    const q = rangeQuery.parse(req.query);
    const asOf = await todayIST(pool);
    const { rows } = await pool.query(
      `SELECT o.id, o.order_number AS "orderNumber", o.order_date AS "orderDate", o.customer_id AS "customerId",
         c.name AS "customerName", c.phone AS "customerPhone",
         o.total_paise AS "totalPaise", o.amount_paid_paise AS "paidPaise", (o.total_paise - o.amount_paid_paise)::bigint AS "duePaise",
         GREATEST($2::date - o.order_date, 0)::int AS "ageDays",
         i.id AS "invoiceId", i.invoice_number AS "invoiceNumber"
       FROM orders o
       LEFT JOIN customers c ON c.id = o.customer_id
       LEFT JOIN invoices i ON i.order_id = o.id AND i.status = 'issued'
       WHERE o.shop_id = $1 AND o.status <> 'cancelled' AND o.total_paise > o.amount_paid_paise
         AND ($3::date IS NULL OR o.order_date >= $3::date) AND ($4::date IS NULL OR o.order_date <= $4::date)
       ORDER BY o.order_date, o.id`,
      [shopId, asOf, q.from ?? null, q.to ?? null],
    );

    const totals = { ...emptyBuckets(), totalPaise: 0, orders: 0 };
    const byCustomer = new Map<string, { customerId: number | null; customerName: string; customerPhone: string | null; totalPaise: number; orders: number; oldestOrderDate: string } & Record<Bucket, number>>();
    const orders = rows.map((o) => {
      const bucket = bucketFor(o.ageDays);
      totals[bucket] += o.duePaise;
      totals.totalPaise += o.duePaise;
      totals.orders += 1;
      const key = o.customerId ? String(o.customerId) : 'walk-in';
      let cu = byCustomer.get(key);
      if (!cu) {
        cu = { customerId: o.customerId, customerName: o.customerName ?? 'Walk-in sales', customerPhone: o.customerPhone ?? null, totalPaise: 0, orders: 0, oldestOrderDate: o.orderDate, ...emptyBuckets() };
        byCustomer.set(key, cu);
      }
      cu[bucket] += o.duePaise;
      cu.totalPaise += o.duePaise;
      cu.orders += 1;
      return { ...o, bucket };
    });
    const customers = [...byCustomer.values()].sort((a, b) => b.totalPaise - a.totalPaise || a.customerName.localeCompare(b.customerName));
    res.json({ asOf, from: q.from ?? null, to: q.to ?? null, buckets: AGEING_BUCKETS, totals, customers, orders });
  }),
);

const MAX_DAYS = 366;

/**
 * Collections by payment date and method: money received, money refunded and the net, from the
 * payment ledger (removed entries excluded). Each ledger entry is counted once, on its own date.
 */
reportsRouter.get(
  '/collections',
  ah(async (req, res) => {
    const shopId = auth(req).shopId;
    const q = rangeQuery.parse(req.query);
    const today = await todayIST(pool);
    const to = q.to ?? today;
    const { rows: fromRows } = await pool.query(`SELECT ($1::date - 29)::date AS d`, [to]);
    const from = q.from ?? fromRows[0].d;
    if (from > to) throw new AppError(400, 'VALIDATION_ERROR', 'The start date is after the end date', { from: 'The start date is after the end date' });
    const { rows: span } = await pool.query(`SELECT ($2::date - $1::date + 1)::int AS days`, [from, to]);
    if (span[0].days > MAX_DAYS) throw new AppError(400, 'VALIDATION_ERROR', `Choose up to ${MAX_DAYS} days`, { from: `Choose up to ${MAX_DAYS} days` });

    const { rows } = await pool.query(
      `SELECT p.paid_on AS date, p.method,
         COALESCE(sum(p.amount_paise) FILTER (WHERE p.kind = 'payment'), 0)::bigint AS "receivedPaise",
         COALESCE(sum(p.amount_paise) FILTER (WHERE p.kind = 'refund'), 0)::bigint AS "refundedPaise",
         count(*) FILTER (WHERE p.kind = 'payment')::int AS payments,
         count(*) FILTER (WHERE p.kind = 'refund')::int AS refunds
       FROM payments p
       WHERE p.shop_id = $1 AND p.voided_at IS NULL AND p.paid_on >= $2::date AND p.paid_on <= $3::date
       GROUP BY p.paid_on, p.method
       ORDER BY p.paid_on, p.method`,
      [shopId, from, to],
    );

    const rowsOut = rows.map((r) => ({ ...r, netPaise: r.receivedPaise - r.refundedPaise }));
    const sum = (list: typeof rowsOut) => ({
      receivedPaise: list.reduce((s, r) => s + r.receivedPaise, 0),
      refundedPaise: list.reduce((s, r) => s + r.refundedPaise, 0),
      netPaise: list.reduce((s, r) => s + r.netPaise, 0),
      payments: list.reduce((s, r) => s + r.payments, 0),
      refunds: list.reduce((s, r) => s + r.refunds, 0),
    });
    const methods = [...new Set(rowsOut.map((r) => r.method as string))];
    const dates = [...new Set(rowsOut.map((r) => r.date as string))];
    res.json({
      from,
      to,
      rows: rowsOut,
      byMethod: methods.map((method) => ({ method, ...sum(rowsOut.filter((r) => r.method === method)) })),
      byDate: dates.map((date) => ({ date, ...sum(rowsOut.filter((r) => r.date === date)) })),
      totals: sum(rowsOut),
    });
  }),
);
