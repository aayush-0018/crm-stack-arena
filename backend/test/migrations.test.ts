import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { applyMigration, migrationFiles, resetDb, sql } from './helpers';

// Upgrade tests: build the schema as it was before a migration, add data, then apply it.
after(async () => {
  const { pool } = await import('../src/db/pool');
  await pool.end();
});

const before007 = () => migrationFiles().filter((f) => f < '007');

describe('007_payments upgrade', () => {
  test('every order with money paid gets exactly one opening entry; nothing else changes', async () => {
    await resetDb(before007());
    const [shop] = await sql(`INSERT INTO shops (name) VALUES ('Old shop') RETURNING id`);
    await sql(`INSERT INTO shop_counters (shop_id) VALUES ($1)`, [shop.id]);
    const [cust] = await sql(`INSERT INTO customers (shop_id, name, phone) VALUES ($1, 'C', '9876500000') RETURNING id`, [shop.id]);
    const mk = (n: string, total: number, paid: number, status: string, date: string) =>
      sql(
        `INSERT INTO orders (shop_id, customer_id, order_number, status, payment_status, subtotal_paise, total_paise, amount_paid_paise, order_date)
         VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8) RETURNING id`,
        [shop.id, cust.id, n, status, paid === 0 ? 'unpaid' : paid < total ? 'partial' : 'paid', total, paid, date],
      );
    await mk('ORD-1', 10000, 10000, 'completed', '2026-01-05');
    await mk('ORD-2', 10000, 2500, 'open', '2026-02-10');
    await mk('ORD-3', 10000, 0, 'open', '2026-03-15');
    await mk('ORD-4', 5000, 5000, 'cancelled', '2026-04-20');
    const snapshot = await sql(`SELECT id, status, payment_status, amount_paid_paise, version FROM orders ORDER BY id`);

    await applyMigration('007_payments.sql');

    const ledger = await sql(`SELECT o.order_number, p.kind, p.amount_paise, p.method, p.paid_on::text FROM payments p JOIN orders o ON o.id = p.order_id ORDER BY o.id`);
    assert.deepEqual(ledger, [
      { order_number: 'ORD-1', kind: 'payment', amount_paise: 10000, method: 'unrecorded', paid_on: '2026-01-05' },
      { order_number: 'ORD-2', kind: 'payment', amount_paise: 2500, method: 'unrecorded', paid_on: '2026-02-10' },
      { order_number: 'ORD-4', kind: 'payment', amount_paise: 5000, method: 'unrecorded', paid_on: '2026-04-20' },
    ]);
    assert.deepEqual(await sql(`SELECT id, status, payment_status, amount_paid_paise, version FROM orders ORDER BY id`), snapshot);
  });

  test('a fresh database applies every migration cleanly', async () => {
    await resetDb();
    const applied = await sql(`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'`);
    assert.ok(applied[0].n > 0);
  });
});

describe('008_zero_total_orders upgrade', () => {
  test('existing ₹0 "unpaid" orders become paid; invoiced ones complete; nothing else changes', async () => {
    await resetDb(migrationFiles().filter((f) => f < '008'));
    const [shop] = await sql(`INSERT INTO shops (name) VALUES ('S') RETURNING id`);
    const [cust] = await sql(`INSERT INTO customers (shop_id, name, phone) VALUES ($1, 'C', '9876500001') RETURNING id`, [shop.id]);
    const mk = async (n: string, total: number, paid: number, status = 'open') =>
      (await sql(
        `INSERT INTO orders (shop_id, customer_id, order_number, status, payment_status, subtotal_paise, total_paise, amount_paid_paise)
         VALUES ($1, $2, $3, $4, $5, $6, $6, $7) RETURNING id`,
        [shop.id, cust.id, n, status, paid === 0 ? 'unpaid' : paid < total ? 'partial' : 'paid', total, paid],
      ))[0].id as number;
    const zeroInvoiced = await mk('Z1', 0, 0);
    const zeroOpen = await mk('Z2', 0, 0);
    const zeroCancelled = await mk('Z3', 0, 0, 'cancelled');
    const normal = await mk('N1', 5000, 0);
    await sql(
      `INSERT INTO invoices (shop_id, order_id, invoice_number, order_version, invoice_date, shop_snapshot, customer_snapshot,
         order_snapshot, items_snapshot, subtotal_paise, discount_paise, total_paise, amount_paid_paise, payment_status)
       VALUES ($1, $2, 'INV-1', 1, '2026-01-01', '{}', '{}', '{}', '[]', 0, 0, 0, 0, 'unpaid')`,
      [shop.id, zeroInvoiced],
    );

    await applyMigration('008_zero_total_orders.sql');

    const rows = Object.fromEntries((await sql(`SELECT id, status, payment_status FROM orders`)).map((r: any) => [r.id, `${r.status}/${r.payment_status}`]));
    assert.equal(rows[zeroInvoiced], 'completed/paid');
    assert.equal(rows[zeroOpen], 'open/paid');
    assert.equal(rows[zeroCancelled], 'cancelled/paid');
    assert.equal(rows[normal], 'open/unpaid');
    // the issued invoice's snapshot is history and is left alone
    assert.equal((await sql(`SELECT payment_status FROM invoices`))[0].payment_status, 'unpaid');
    // the new rule is enforced: a ₹0 order can no longer be stored as unpaid
    await assert.rejects(sql(`UPDATE orders SET payment_status = 'unpaid' WHERE id = $1`, [zeroOpen]));
  });
});
