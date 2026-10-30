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
