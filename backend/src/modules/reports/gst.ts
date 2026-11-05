import { pool } from '../../db/pool';
import { AppError } from '../../lib/errors';
import { gstBreakup, GstSplit, splitInclusive } from '../../lib/gst';

const MAX_DAYS = 366;

export interface GstReportRow extends GstSplit {
  /** YYYY-MM; only on month rows. */
  month?: string;
  rate: number;
  /** Sales (incl. GST, after discounts) minus returns = grossPaise. */
  salesPaise: number;
  returnsPaise: number;
}

/**
 * GST summary for a date range. Sales are counted on the order date (cancelled orders left out),
 * returns on the return date. Prices include GST, so each rate's GST is worked out from the net
 * amount. A line sold before its product had a rate uses the product's current rate; a line
 * with no rate at all is reported separately as "no GST rate".
 */
export async function gstReport(shopId: number, today: string, q: { from?: string; to?: string }) {
  const to = q.to ?? today;
  const from = q.from ?? `${to.slice(0, 7)}-01`; // default: this month so far
  if (from > to) throw new AppError(400, 'VALIDATION_ERROR', 'The start date is after the end date', { from: 'The start date is after the end date' });
  const { rows: span } = await pool.query(`SELECT ($2::date - $1::date + 1)::int AS days`, [from, to]);
  if (span[0].days > MAX_DAYS) throw new AppError(400, 'VALIDATION_ERROR', `Choose up to ${MAX_DAYS} days`, { from: `Choose up to ${MAX_DAYS} days` });

  const { rows: lines } = await pool.query(
    `SELECT o.id, to_char(o.order_date, 'YYYY-MM') AS month, o.discount_paise AS "discountPaise",
       oi.line_total_paise AS "lineTotalPaise", COALESCE(oi.gst_rate, p.gst_rate)::float8 AS "gstRate"
     FROM orders o
     JOIN order_items oi ON oi.order_id = o.id
     LEFT JOIN products p ON p.id = oi.product_id
     WHERE o.shop_id = $1 AND o.status <> 'cancelled' AND o.order_date BETWEEN $2::date AND $3::date
     ORDER BY o.id, oi.position`,
    [shopId, from, to],
  );
  const { rows: returns } = await pool.query(
    `SELECT to_char(r.return_date, 'YYYY-MM') AS month, COALESCE(oi.gst_rate, p.gst_rate)::float8 AS "gstRate",
       sum(ri.value_paise)::bigint AS "valuePaise"
     FROM order_returns r
     JOIN orders o ON o.id = r.order_id
     JOIN order_return_items ri ON ri.return_id = r.id
     LEFT JOIN order_items oi ON oi.order_id = r.order_id AND oi.position = ri.position
     LEFT JOIN products p ON p.id = ri.product_id
     WHERE r.shop_id = $1 AND o.status <> 'cancelled' AND r.return_date BETWEEN $2::date AND $3::date
     GROUP BY 1, 2`,
    [shopId, from, to],
  );

  // Sales and returns per month and rate ('none' = no rate).
  const cells = new Map<string, { month: string; rate: number | null; salesPaise: number; returnsPaise: number }>();
  const cell = (month: string, rate: number | null) => {
    const key = `${month}|${rate ?? 'none'}`;
    let c = cells.get(key);
    if (!c) cells.set(key, (c = { month, rate, salesPaise: 0, returnsPaise: 0 }));
    return c;
  };
  for (let i = 0; i < lines.length; ) {
    let j = i;
    while (j < lines.length && lines[j].id === lines[i].id) j++;
    const order = lines.slice(i, j);
    const { rows, unratedPaise } = gstBreakup(order, Number(order[0].discountPaise));
    for (const r of rows) cell(order[0].month, r.rate).salesPaise += r.grossPaise;
    if (unratedPaise) cell(order[0].month, null).salesPaise += unratedPaise;
    i = j;
  }
  for (const r of returns) cell(r.month, r.gstRate).returnsPaise += Number(r.valuePaise);

  const toRow = (c: { month?: string; rate: number; salesPaise: number; returnsPaise: number }): GstReportRow => ({
    ...c,
    ...splitInclusive(c.salesPaise - c.returnsPaise, c.rate),
  });
  const all = [...cells.values()];
  const rated = all.filter((c): c is typeof c & { rate: number } => c.rate !== null);
  const byMonth = rated.sort((a, b) => a.month.localeCompare(b.month) || a.rate - b.rate).map(toRow);

  const rates = [...new Set(rated.map((c) => c.rate))].sort((a, b) => a - b);
  const byRate = rates.map((rate) => {
    const list = rated.filter((c) => c.rate === rate);
    return toRow({
      rate,
      salesPaise: list.reduce((s, c) => s + c.salesPaise, 0),
      returnsPaise: list.reduce((s, c) => s + c.returnsPaise, 0),
    });
  });

  const sum = (k: keyof GstSplit | 'salesPaise' | 'returnsPaise') => byRate.reduce((s, r) => s + r[k], 0);
  const none = all.filter((c) => c.rate === null);
  return {
    from,
    to,
    byRate,
    byMonth,
    totals: {
      salesPaise: sum('salesPaise'),
      returnsPaise: sum('returnsPaise'),
      grossPaise: sum('grossPaise'),
      taxablePaise: sum('taxablePaise'),
      cgstPaise: sum('cgstPaise'),
      sgstPaise: sum('sgstPaise'),
      taxPaise: sum('taxPaise'),
    },
    /** Sales whose items have no GST rate (free-text items, or products without a rate). */
    unrated: {
      salesPaise: none.reduce((s, c) => s + c.salesPaise, 0),
      returnsPaise: none.reduce((s, c) => s + c.returnsPaise, 0),
    },
  };
}
