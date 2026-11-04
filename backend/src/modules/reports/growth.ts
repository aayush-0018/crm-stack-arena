import { z } from 'zod';
import { pool } from '../../db/pool';
import { fyName, fyStartMonth, fyStartYear } from '../../lib/fy';

/**
 * Growth: month-on-month, quarter-on-quarter and year-on-year.
 *
 * Money follows the dashboard: sales = order totals (after discounts and returns) by order date,
 * cancelled orders left out; money received = payments minus refunds by payment date. Quarters and
 * years follow the shop's financial year (`fy` = the month it starts in; 1 = calendar year).
 * Orders dated in the future are not counted yet.
 */

export const GRAINS = ['month', 'quarter', 'year'] as const;
export type Grain = (typeof GRAINS)[number];
export const BASES = ['to_date', 'last_full'] as const;
export const DIMENSIONS = ['category', 'product', 'channel', 'payment'] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export const growthQuery = z.object({
  grain: z.enum(GRAINS).default('month'),
  /** to_date: this period so far vs the same number of days before; last_full: the last complete period. */
  basis: z.enum(BASES).default('to_date'),
  by: z.enum(DIMENSIONS).default('category'),
});

const STEP: Record<Grain, number> = { month: 1, quarter: 3, year: 12 };
/** How many periods the trend shows. */
const SHOWN: Record<Grain, number> = { month: 12, quarter: 8, year: 5 };

// ---- Plain calendar maths on YYYY-MM-DD strings (UTC, so no time-zone drift).
const parse = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const fmt = (d: Date) => d.toISOString().slice(0, 10);
export const addMonths = (iso: string, n: number) => {
  const d = parse(iso);
  return fmt(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate())));
};
export const addDays = (iso: string, n: number) => fmt(new Date(parse(iso).getTime() + n * 86_400_000));
const daysBetween = (a: string, b: string) => Math.round((parse(b).getTime() - parse(a).getTime()) / 86_400_000);
const minDate = (a: string, b: string) => (a < b ? a : b);

const ymd = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}-01`;

/** First day of the month, quarter or (financial) year that `iso` falls in. */
export function startOf(grain: Grain, iso: string, fy = 1) {
  const [y, m] = iso.split('-').map(Number);
  if (grain === 'month') return ymd(y, m);
  if (grain === 'year') return ymd(fyStartYear(iso, fy), fy);
  // Months since the year started, rounded down to a quarter.
  const back = ((m - fy + 12) % 12) % 3;
  return addMonths(ymd(y, m), -back);
}
const endOf = (grain: Grain, start: string) => addDays(addMonths(start, STEP[grain]), -1);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Nov 2026"; "Q3 2026" / "2026" for calendar years; "Q3 FY 2026-27" / "FY 2026-27" otherwise. */
export function periodLabel(grain: Grain, start: string, fy = 1) {
  const [y, m] = start.split('-').map(Number);
  if (grain === 'month') return `${MONTHS[m - 1]} ${y}`;
  const name = fyName(fyStartYear(start, fy), fy);
  const year = fy === 1 ? name : `FY ${name}`;
  if (grain === 'year') return year;
  return `Q${Math.floor(((m - fy + 12) % 12) / 3) + 1} ${year}`;
}

export interface Range {
  from: string;
  to: string;
  label: string;
}

/**
 * The three ranges compared. "So far" compares like for like: if today is the 10th day of the
 * month, it's the first 10 days of last month, and of this month a year ago.
 */
export function comparisonRanges(grain: Grain, basis: 'to_date' | 'last_full', today: string, fy = 1) {
  const curStart = startOf(grain, today, fy);
  if (basis === 'to_date') {
    const elapsed = daysBetween(curStart, today);
    const prevStart = addMonths(curStart, -STEP[grain]);
    const lyStart = addMonths(curStart, -12);
    const tag = (start: string, to: string) => `${periodLabel(grain, start, fy)}${to === endOf(grain, start) ? '' : ` (to ${parse(to).getUTCDate()} ${MONTHS[parse(to).getUTCMonth()]})`}`;
    const prevTo = minDate(addDays(prevStart, elapsed), endOf(grain, prevStart));
    const lyTo = minDate(addDays(lyStart, elapsed), endOf(grain, lyStart));
    return {
      current: { from: curStart, to: today, label: tag(curStart, today) },
      previous: { from: prevStart, to: prevTo, label: tag(prevStart, prevTo) },
      lastYear: { from: lyStart, to: lyTo, label: tag(lyStart, lyTo) },
    };
  }
  const start = addMonths(curStart, -STEP[grain]);
  const prevStart = addMonths(start, -STEP[grain]);
  const lyStart = addMonths(start, -12);
  const full = (s: string): Range => ({ from: s, to: endOf(grain, s), label: periodLabel(grain, s, fy) });
  return { current: full(start), previous: full(prevStart), lastYear: full(lyStart) };
}

export interface Metrics {
  revenuePaise: number;
  orders: number;
  aovPaise: number;
  customers: number;
  newCustomers: number;
  receivedPaise: number;
}

const withAov = (m: Omit<Metrics, 'aovPaise'>): Metrics => ({ ...m, aovPaise: m.orders ? Math.round(m.revenuePaise / m.orders) : 0 });

// A customer's first order (not cancelled) makes them new in that period.
const FIRST_ORDERS = `SELECT customer_id, min(order_date) AS d FROM orders
  WHERE shop_id = $1 AND status <> 'cancelled' AND customer_id IS NOT NULL GROUP BY customer_id`;
const NET = `CASE WHEN kind = 'payment' THEN amount_paise ELSE -amount_paise END`;

async function metricsFor(shopId: number, r: Range): Promise<Metrics> {
  const { rows } = await pool.query(
    `WITH o AS (
       SELECT COALESCE(sum(total_paise), 0)::bigint AS rev, count(*)::int AS n, count(DISTINCT customer_id)::int AS buyers
       FROM orders WHERE shop_id = $1 AND status <> 'cancelled' AND order_date BETWEEN $2::date AND $3::date
     ), f AS (
       SELECT count(*)::int AS n FROM (${FIRST_ORDERS}) x WHERE d BETWEEN $2::date AND $3::date
     ), p AS (
       SELECT COALESCE(sum(${NET}), 0)::bigint AS r FROM payments
       WHERE shop_id = $1 AND voided_at IS NULL AND paid_on BETWEEN $2::date AND $3::date
     )
     SELECT o.rev, o.n, o.buyers, f.n AS fresh, p.r FROM o, f, p`,
    [shopId, r.from, r.to],
  );
  const x = rows[0];
  return withAov({ revenuePaise: Number(x.rev), orders: x.n, customers: x.buyers, newCustomers: x.fresh, receivedPaise: Number(x.r) });
}

/** One row per period, oldest first, with enough history for a year-on-year figure on every shown period. */
async function series(shopId: number, grain: Grain, today: string, fy: number) {
  const lag = 12 / STEP[grain];
  const curStart = startOf(grain, today, fy);
  const first = addMonths(curStart, -STEP[grain] * (SHOWN[grain] + lag - 1));
  const unit = grain;
  // Quarters and years start in the shop's financial-year month: shift back, truncate, shift forward.
  const trunc = (col: string) => `(date_trunc($5, (${col} - $7::int * interval '1 month')::timestamp) + $7::int * interval '1 month')::date`;
  const { rows } = await pool.query(
    `WITH periods AS (
       SELECT generate_series($2::date, $3::date, $4::interval)::date AS p
     ), o AS (
       SELECT ${trunc('order_date')} AS p, sum(total_paise)::bigint AS rev, count(*)::int AS n,
         count(DISTINCT customer_id)::int AS buyers
       FROM orders WHERE shop_id = $1 AND status <> 'cancelled' AND order_date >= $2::date AND order_date <= $6::date GROUP BY 1
     ), f AS (
       SELECT ${trunc('d')} AS p, count(*)::int AS n FROM (${FIRST_ORDERS}) x
       WHERE d >= $2::date AND d <= $6::date GROUP BY 1
     ), pay AS (
       SELECT ${trunc('paid_on')} AS p, sum(${NET})::bigint AS r FROM payments
       WHERE shop_id = $1 AND voided_at IS NULL AND paid_on >= $2::date AND paid_on <= $6::date GROUP BY 1
     )
     SELECT to_char(periods.p, 'YYYY-MM-DD') AS start, COALESCE(o.rev, 0)::bigint AS rev, COALESCE(o.n, 0)::int AS n,
       COALESCE(o.buyers, 0)::int AS buyers, COALESCE(f.n, 0)::int AS fresh, COALESCE(pay.r, 0)::bigint AS r
     FROM periods LEFT JOIN o USING (p) LEFT JOIN f USING (p) LEFT JOIN pay USING (p)
     ORDER BY periods.p`,
    [shopId, first, curStart, `${STEP[grain]} months`, unit, today, grain === 'month' ? 0 : fy - 1],
  );
  const all = rows.map((x) => ({
    start: x.start as string,
    label: periodLabel(grain, x.start, fy),
    partial: x.start === curStart,
    ...withAov({ revenuePaise: Number(x.rev), orders: x.n, customers: x.buyers, newCustomers: x.fresh, receivedPaise: Number(x.r) }),
  }));
  // Each shown period carries the one before it and the same one a year earlier.
  return all.slice(lag).map((p, i) => ({ ...p, previous: all[lag + i - 1] ?? null, lastYear: all[i] }));
}

/** Sales by category, product, channel, or money received by payment method, for the three ranges. */
async function breakdown(shopId: number, by: Dimension, ranges: { current: Range; previous: Range; lastYear: Range }) {
  const { current: c, previous: p, lastYear: l } = ranges;
  const params = [shopId, c.from, c.to, p.from, p.to, l.from, l.to];
  const dateCol = by === 'payment' ? 'paid_on' : 'o.order_date';
  const sums = (expr: string) =>
    `COALESCE(sum(${expr}) FILTER (WHERE ${dateCol} BETWEEN $2::date AND $3::date), 0)::bigint AS current,
     COALESCE(sum(${expr}) FILTER (WHERE ${dateCol} BETWEEN $4::date AND $5::date), 0)::bigint AS previous,
     COALESCE(sum(${expr}) FILTER (WHERE ${dateCol} BETWEEN $6::date AND $7::date), 0)::bigint AS "lastYear"`;
  const inAny = `(${dateCol} BETWEEN $2::date AND $3::date OR ${dateCol} BETWEEN $4::date AND $5::date OR ${dateCol} BETWEEN $6::date AND $7::date)`;
  // A line's sales, less whatever of it was returned.
  const line = `(oi.line_total_paise - COALESCE((SELECT sum(ri.gross_paise) FROM order_return_items ri JOIN order_returns r ON r.id = ri.return_id
    WHERE r.order_id = oi.order_id AND ri.position = oi.position), 0))`;

  let sql: string;
  if (by === 'category' || by === 'product') {
    const key = by === 'category' ? `COALESCE(NULLIF(trim(pr.category), ''), 'No category')` : 'oi.item_name';
    sql = `SELECT ${key} AS label, ${sums(line)}
      FROM order_items oi JOIN orders o ON o.id = oi.order_id
      ${by === 'category' ? 'LEFT JOIN products pr ON pr.id = oi.product_id' : ''}
      WHERE o.shop_id = $1 AND o.status <> 'cancelled' AND ${inAny}
      GROUP BY 1`;
  } else if (by === 'channel') {
    sql = `SELECT CASE WHEN o.source = 'table' OR o.table_id IS NOT NULL THEN 'Table orders'
                       WHEN o.customer_id IS NULL THEN 'Walk-in sales' ELSE 'Customer orders' END AS label, ${sums('o.total_paise')}
      FROM orders o WHERE o.shop_id = $1 AND o.status <> 'cancelled' AND ${inAny}
      GROUP BY 1`;
  } else {
    sql = `SELECT method AS label, ${sums(NET)}
      FROM payments WHERE shop_id = $1 AND voided_at IS NULL AND ${inAny}
      GROUP BY 1`;
  }
  const { rows } = await pool.query(sql, params);
  return rows
    .map((r) => ({ label: r.label as string, current: Number(r.current), previous: Number(r.previous), lastYear: Number(r.lastYear) }))
    .sort((a, b) => b.current - a.current || b.previous - a.previous || a.label.localeCompare(b.label))
    .slice(0, by === 'product' ? 15 : 50);
}

export async function growthReport(shopId: number, today: string, q: z.infer<typeof growthQuery>) {
  const fy = await fyStartMonth(pool, shopId);
  const ranges = comparisonRanges(q.grain, q.basis, today, fy);
  const [current, previous, lastYear, trend, rows] = await Promise.all([
    metricsFor(shopId, ranges.current),
    metricsFor(shopId, ranges.previous),
    metricsFor(shopId, ranges.lastYear),
    series(shopId, q.grain, today, fy),
    breakdown(shopId, q.by, ranges),
  ]);
  return {
    grain: q.grain,
    basis: q.basis,
    fyStartMonth: fy,
    today,
    ranges,
    summary: { current, previous, lastYear },
    series: trend,
    breakdown: { by: q.by, rows },
  };
}
