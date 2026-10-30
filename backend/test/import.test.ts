import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { newShop, nextPhone, sql, start, stop } from './helpers';

before(start);
after(stop);

describe('customer CSV import', () => {
  test('a preview saves nothing, and the real import matches the preview', async () => {
    const { api, shopId } = await newShop();
    const rows = [
      { name: 'Asha', phone: nextPhone() },
      { name: 'Ravi', phone: nextPhone(), email: 'ravi@example.test' },
      { name: '', phone: '123' },
    ];
    const preview = (await api.post('/customers/import', { rows, dryRun: true })).body;
    assert.deepEqual([preview.created, preview.updated, preview.failed], [2, 0, 1]);
    assert.equal(preview.rows[2].row, 4, 'row numbers count the header as line 1');
    assert.ok(preview.rows[2].errors.name && preview.rows[2].errors.phone);
    assert.equal(preview.rows[0].id, undefined, 'a preview has no IDs for new rows');
    assert.equal((await sql(`SELECT 1 FROM customers WHERE shop_id = $1`, [shopId])).length, 0);

    const real = (await api.post('/customers/import', { rows, dryRun: false })).body;
    assert.deepEqual([real.created, real.updated, real.failed], [2, 0, 1]);
    assert.ok(real.rows[0].id);
    assert.equal((await sql(`SELECT 1 FROM customers WHERE shop_id = $1`, [shopId])).length, 2);
  });

  test('a row with an existing ID updates that customer; without an ID it creates one', async () => {
    const { api } = await newShop();
    const c = (await api.post('/customers', { name: 'Old name', phone: nextPhone() })).body;
    const r = (
      await api.post('/customers/import', {
        dryRun: false,
        rows: [
          { id: String(c.id), name: 'New name', phone: c.phone, notes: 'Imported' },
          { id: '', name: 'Fresh', phone: nextPhone() },
        ],
      })
    ).body;
    assert.deepEqual([r.created, r.updated, r.failed], [1, 1, 0]);
    const after = (await api.get(`/customers/${c.id}`)).body;
    assert.equal(after.name, 'New name');
    assert.equal(after.notes, 'Imported');
  });

  test('duplicates and unknown IDs are rejected per row; the other rows still import', async () => {
    const { api } = await newShop();
    const existing = (await api.post('/customers', { name: 'Has phone', phone: nextPhone() })).body;
    const shared = nextPhone();
    const other = await newShop('Other');
    const foreign = (await other.api.post('/customers', { name: 'Not yours', phone: nextPhone() })).body;
    const r = (
      await api.post('/customers/import', {
        dryRun: false,
        rows: [
          { name: 'Clash', phone: existing.phone },
          { name: 'First', phone: shared },
          { name: 'Second', phone: shared },
          { id: '999999', name: 'Ghost', phone: nextPhone() },
          { id: String(foreign.id), name: 'Hijack', phone: nextPhone() },
          { id: 'abc', name: 'Bad id', phone: nextPhone() },
        ],
      })
    ).body;
    assert.deepEqual([r.created, r.updated, r.failed], [1, 0, 5]);
    assert.match(r.rows[0].errors.phone, new RegExp(`customer ID ${existing.id}`));
    assert.match(r.rows[2].errors.phone, /already used/);
    assert.match(r.rows[3].errors.id, /No customer with ID/);
    assert.match(r.rows[4].errors.id, /No customer with ID/, "another shop's customer is never touched");
    assert.equal((await other.api.get(`/customers/${foreign.id}`)).body.name, 'Not yours');
  });

  test('too many rows or an empty file is refused', async () => {
    const { api } = await newShop();
    const many = Array.from({ length: 1001 }, (_, i) => ({ name: `C${i}`, phone: '' }));
    assert.equal((await api.post('/customers/import', { rows: many, dryRun: true })).status, 400);
    assert.equal((await api.post('/customers/import', { rows: [], dryRun: true })).status, 400);
  });
});

describe('product CSV import', () => {
  test('new products get their opening stock; updates never change stock', async () => {
    const { api } = await newShop();
    const r = (
      await api.post('/products/import', {
        dryRun: false,
        rows: [
          { name: 'Rice', price: '55', unit: 'KG', openingStock: '20', lowStockAt: '5' },
          { name: 'Bag', price: '10', trackStock: 'no', openingStock: '7' },
        ],
      })
    ).body;
    assert.deepEqual([r.created, r.updated, r.failed], [2, 0, 0]);
    const rice = (await api.get(`/products/${r.rows[0].id}`)).body;
    assert.equal(rice.unit, 'kg');
    assert.equal(rice.stockMilli, 20000);
    assert.equal((await api.get(`/products/${r.rows[1].id}`)).body.stockMilli, 0, 'untracked: no opening stock');

    const u = (
      await api.post('/products/import', { dryRun: false, rows: [{ id: String(rice.id), name: 'Rice', price: '60', unit: 'kg', openingStock: '99' }] })
    ).body;
    assert.equal(u.updated, 1);
    assert.match(u.rows[0].note, /Opening stock ignored/);
    const after = (await api.get(`/products/${rice.id}`)).body;
    assert.equal(after.pricePaise, 6000);
    assert.equal(after.stockMilli, 20000);
  });

  test('name and SKU clashes, bad values and a preview', async () => {
    const { api, shopId } = await newShop();
    await api.post('/products', { name: 'Tea', price: '10', sku: 'T1' });
    const rows = [
      { name: 'tea', price: '12' },
      { name: 'Coffee', price: '12', sku: 't1' },
      { name: 'Sugar', price: 'abc', unit: 'litre', trackStock: 'maybe' },
      { name: 'Salt', price: '20' },
      { name: 'Salt', price: '21' },
    ];
    const p = (await api.post('/products/import', { rows, dryRun: true })).body;
    assert.deepEqual([p.created, p.failed], [1, 4]);
    assert.ok(p.rows[0].errors.name && p.rows[1].errors.sku);
    assert.ok(p.rows[2].errors.price && p.rows[2].errors.unit && p.rows[2].errors.trackStock);
    assert.ok(p.rows[4].errors.name, 'the same name twice in one file');
    assert.equal((await sql(`SELECT 1 FROM products WHERE shop_id = $1`, [shopId])).length, 1, 'preview saved nothing');
  });
});
