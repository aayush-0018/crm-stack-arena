/**
 * Read-only check of invoices marked "Needs reissue".
 * Usage: npm run check-reissue   (uses DATABASE_URL, like every script)
 *
 * Before payment history existed (migration 007), recording a payment bumped the order's version,
 * which marks its issued invoice "Needs reissue" even though nothing billed changed. This lists every
 * issued invoice whose order version moved on, and says whether anything printed on it actually differs
 * (items, prices, discount, notes, order date) or whether it was only flagged by an old payment.
 * It runs in a READ ONLY transaction and changes nothing.
 */
import { pool } from '../src/db/pool';

interface Row {
  shopName: string;
  invoiceNumber: string;
  revision: number;
  orderNumber: string;
  sameItems: boolean;
  sameDiscount: boolean;
  sameNotes: boolean;
  sameDate: boolean;
}

async function main() {
  const c = await pool.connect();
  try {
    await c.query('BEGIN READ ONLY');
    const { rows } = await c.query<Row>(
      `SELECT s.name AS "shopName", i.invoice_number AS "invoiceNumber", i.revision, o.order_number AS "orderNumber",
         (SELECT COALESCE(jsonb_agg(jsonb_build_object('p', x->>'position', 'n', x->>'itemName', 'q', (x->>'quantity')::numeric,
                    'u', (x->>'unitPricePaise')::bigint, 't', (x->>'lineTotalPaise')::bigint) ORDER BY (x->>'position')::int), '[]'::jsonb)
            FROM jsonb_array_elements(i.items_snapshot) x)
         = (SELECT COALESCE(jsonb_agg(jsonb_build_object('p', oi.position::text, 'n', oi.item_name, 'q', oi.quantity,
                    'u', oi.unit_price_paise, 't', oi.line_total_paise) ORDER BY oi.position), '[]'::jsonb)
            FROM order_items oi WHERE oi.order_id = o.id) AS "sameItems",
         i.discount_paise = o.discount_paise AS "sameDiscount",
         (i.order_snapshot->>'notes') IS NOT DISTINCT FROM o.notes AS "sameNotes",
         (i.order_snapshot->>'orderDate')::date = o.order_date AS "sameDate"
       FROM invoices i JOIN orders o ON o.id = i.order_id JOIN shops s ON s.id = i.shop_id
       WHERE i.status = 'issued' AND i.order_version <> o.version
       ORDER BY s.name, i.invoice_number`,
    );
    await c.query('ROLLBACK');

    const onlyPayments = rows.filter((r) => r.sameItems && r.sameDiscount && r.sameNotes && r.sameDate);
    const changed = rows.filter((r) => !onlyPayments.includes(r));
    console.log(`Invoices marked "Needs reissue": ${rows.length}`);
    console.log(`  Nothing billed changed (flagged by an old payment only): ${onlyPayments.length}`);
    for (const r of onlyPayments) console.log(`    ${r.shopName} · ${r.invoiceNumber} (Rev ${r.revision}) · ${r.orderNumber}`);
    console.log(`  Something billed changed (a reissue is genuinely needed): ${changed.length}`);
    for (const r of changed) {
      const what = [!r.sameItems && 'items', !r.sameDiscount && 'discount', !r.sameNotes && 'notes', !r.sameDate && 'order date'].filter(Boolean).join(', ');
      console.log(`    ${r.shopName} · ${r.invoiceNumber} (Rev ${r.revision}) · ${r.orderNumber} · changed: ${what}`);
    }
    console.log('Nothing was changed. Reissue from the order page, or ask for an approved fix for the first group.');
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
