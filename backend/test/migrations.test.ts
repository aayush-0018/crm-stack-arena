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

describe('009_products_inventory upgrade', () => {
  test('existing order lines stay free-text, existing branches block negative stock, nothing else changes', async () => {
    await resetDb(migrationFiles().filter((f) => f < '009'));
    const [shop] = await sql(`INSERT INTO shops (name) VALUES ('S') RETURNING id`);
    const [cust] = await sql(`INSERT INTO customers (shop_id, name, phone) VALUES ($1, 'C', '9876500002') RETURNING id`, [shop.id]);
    const [o] = await sql(
      `INSERT INTO orders (shop_id, customer_id, order_number, subtotal_paise, total_paise) VALUES ($1, $2, 'O1', 1000, 1000) RETURNING id`,
      [shop.id, cust.id],
    );
    await sql(`INSERT INTO order_items (order_id, position, item_name, quantity, unit_price_paise, line_total_paise) VALUES ($1, 1, 'Rice', 2, 500, 1000)`, [o.id]);
    const items = await sql(`SELECT * FROM order_items`);

    await applyMigration('009_products_inventory.sql');

    const after = await sql(`SELECT * FROM order_items`);
    assert.equal(after[0].product_id, null);
    const { product_id: _p, ...rest } = after[0];
    assert.deepEqual(rest, items[0]);
    assert.equal((await sql(`SELECT allow_negative_stock FROM shops`))[0].allow_negative_stock, false);
  });
});

describe('010_walk_in_orders upgrade', () => {
  test('existing orders keep their customer; new orders may have none', async () => {
    await resetDb(migrationFiles().filter((f) => f < '010'));
    const [shop] = await sql(`INSERT INTO shops (name) VALUES ('S') RETURNING id`);
    const [cust] = await sql(`INSERT INTO customers (shop_id, name, phone) VALUES ($1, 'C', '9876500003') RETURNING id`, [shop.id]);
    await sql(`INSERT INTO orders (shop_id, customer_id, order_number, subtotal_paise, total_paise) VALUES ($1, $2, 'O1', 100, 100)`, [shop.id, cust.id]);
    await assert.rejects(sql(`INSERT INTO orders (shop_id, order_number, subtotal_paise, total_paise) VALUES ($1, 'O2', 100, 100)`, [shop.id]));

    await applyMigration('010_walk_in_orders.sql');

    assert.equal((await sql(`SELECT customer_id FROM orders WHERE order_number = 'O1'`))[0].customer_id, cust.id);
    await sql(`INSERT INTO orders (shop_id, order_number, subtotal_paise, total_paise) VALUES ($1, 'O2', 100, 100)`, [shop.id]);
  });
});

describe('011_receipts and 012_returns upgrade', () => {
  test('existing orders, payments and counters are unchanged; the new rules apply', async () => {
    await resetDb(migrationFiles().filter((f) => f < '011'));
    const [shop] = await sql(`INSERT INTO shops (name) VALUES ('S') RETURNING id`);
    await sql(`INSERT INTO shop_counters (shop_id, next_order_seq, next_invoice_seq) VALUES ($1, 7, 3)`, [shop.id]);
    const [cust] = await sql(`INSERT INTO customers (shop_id, name, phone) VALUES ($1, 'C', '9876500004') RETURNING id`, [shop.id]);
    const [o] = await sql(
      `INSERT INTO orders (shop_id, customer_id, order_number, payment_status, subtotal_paise, discount_paise, total_paise, amount_paid_paise)
       VALUES ($1, $2, 'O1', 'partial', 1000, 100, 900, 400) RETURNING *`,
      [shop.id, cust.id],
    );
    const [p] = await sql(
      `INSERT INTO payments (shop_id, order_id, kind, amount_paise, method, paid_on) VALUES ($1, $2, 'payment', 400, 'upi', CURRENT_DATE) RETURNING *`,
      [shop.id, o.id],
    );
    const ordersBefore = await sql(`SELECT * FROM orders ORDER BY id`);

    await applyMigration('011_receipts.sql');
    await applyMigration('012_returns.sql');

    const ordersAfter = await sql(`SELECT * FROM orders ORDER BY id`);
    assert.equal(ordersAfter[0].returned_paise, 0);
    const strip = (rows: any[]) => rows.map(({ returned_paise: _r, ...rest }) => rest);
    assert.deepEqual(strip(ordersAfter), ordersBefore, 'order rows identical apart from the new column');
    const [pAfter] = await sql(`SELECT * FROM payments WHERE id = $1`, [p.id]);
    assert.equal(pAfter.receipt_id, null);
    assert.equal(pAfter.return_id, null);
    assert.equal(pAfter.amount_paise, p.amount_paise);
    const [ctr] = await sql(`SELECT * FROM shop_counters WHERE shop_id = $1`, [shop.id]);
    assert.deepEqual([ctr.next_order_seq, ctr.next_invoice_seq, ctr.next_receipt_seq, ctr.next_refund_seq, ctr.next_return_seq], [7, 3, 1, 1, 1]);
    // The total rule now includes returns.
    await assert.rejects(sql(`UPDATE orders SET returned_paise = 100 WHERE id = $1`, [o.id]));
    await sql(`UPDATE orders SET returned_paise = 100, total_paise = 800 WHERE id = $1`, [o.id]);
    const [prod] = await sql(`INSERT INTO products (shop_id, name, price_paise) VALUES ($1, 'P', 100) RETURNING id`, [shop.id]);
    await sql(`INSERT INTO stock_movements (shop_id, product_id, kind, qty_milli) VALUES ($1, $2, 'return', 1000)`, [shop.id, prod.id]);
  });
});

describe('015_floors_and_guests upgrade', () => {
  test('a saved floor plan becomes its "Ground floor" with the same tables, size and blocks', async () => {
    await resetDb(migrationFiles().filter((f) => f < '015'));
    const [shop] = await sql(`INSERT INTO shops (name) VALUES ('Cafe') RETURNING id`);
    const decor = [{ id: 'k', kind: 'kitchen', x: 0, y: 0, w: 100, h: 100, rotation: 0, label: 'Kitchen' }];
    await sql(`INSERT INTO floor_plans (shop_id, width, height, decor, locked) VALUES ($1, 1500, 900, $2, true)`, [shop.id, JSON.stringify(decor)]);
    const [t] = await sql(
      `INSERT INTO dining_tables (shop_id, label, x, y, w, h, qr_token) VALUES ($1, 'T1', 10, 10, 80, 80, 'tok_aaaaaaaaaaaaaaaaaaaa') RETURNING *`,
      [shop.id],
    );
    const [o] = await sql(`INSERT INTO orders (shop_id, order_number, subtotal_paise, total_paise, table_id) VALUES ($1, 'O1', 100, 100, $2) RETURNING *`, [shop.id, t.id]);

    await applyMigration('015_floors_and_guests.sql');

    const [f] = await sql(`SELECT * FROM floors WHERE shop_id = $1`, [shop.id]);
    assert.deepEqual([f.name, f.width, f.height, f.decor], ['Ground floor', 1500, 900, decor]);
    const [tAfter] = await sql(`SELECT * FROM dining_tables WHERE id = $1`, [t.id]);
    assert.equal(Number(tAfter.floor_id), Number(f.id));
    assert.equal(tAfter.qr_token, t.qr_token);
    const [oAfter] = await sql(`SELECT guest_session_id, bill_sent_at FROM orders WHERE id = $1`, [o.id]);
    assert.deepEqual(oAfter, { guest_session_id: null, bill_sent_at: null });
    assert.equal((await sql(`SELECT locked FROM floor_plans WHERE shop_id = $1`, [shop.id]))[0].locked, true);
  });
});
