import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { Client, newOrder, newShop, sql, start, stop } from './helpers';

before(start);
after(async () => {
  // Invariant: for every live order, the stock taken equals what its tracked product lines need.
  const drift = await sql(
    `WITH need AS (
       SELECT oi.order_id, oi.product_id, sum((oi.quantity * 1000)::bigint) AS q
       FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id
       WHERE o.status <> 'cancelled' AND p.track_stock GROUP BY 1, 2
     ), took AS (
       SELECT m.order_id, m.product_id, -sum(m.qty_milli) AS q
       FROM stock_movements m JOIN products p ON p.id = m.product_id
       WHERE m.order_id IS NOT NULL AND p.track_stock GROUP BY 1, 2
     )
     SELECT * FROM need FULL JOIN took USING (order_id, product_id)
     WHERE COALESCE(need.q, 0) <> COALESCE(took.q, 0)`,
  );
  assert.deepEqual(drift, [], 'orders whose stock movements disagree with their lines');
  await stop();
});

const product = async (api: Client, body: Record<string, unknown> = {}) => {
  const r = await api.post('/products', { name: `Rice ${randomUUID().slice(0, 6)}`, unit: 'kg', price: '50', openingStock: '10', ...body });
  if (r.status !== 201) throw new Error(`product failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};
const stockOf = async (api: Client, id: number) => (await api.get(`/products/${id}`)).body.stockMilli as number;
const line = (p: { id: number; name: string }, qty: string, price = '50') => ({ itemName: p.name, quantity: qty, unitPrice: price, productId: p.id });

describe('product catalogue', () => {
  test('create with opening stock; names and SKUs are unique among active products', async () => {
    const { api } = await newShop();
    const p = await product(api, { name: 'Basmati', sku: 'B-1', cost: '40', lowStockAt: '2' });
    assert.equal(p.stockMilli, 10000);
    assert.equal(p.pricePaise, 5000);
    assert.equal(p.costPaise, 4000);
    assert.equal(p.movements[0].kind, 'opening');
    assert.equal((await api.post('/products', { name: 'basmati', price: '1' })).status, 409);
    assert.equal((await api.post('/products', { name: 'Other', sku: 'b-1', price: '1' })).status, 409);
    await api.patch(`/products/${p.id}/active`, { active: false });
    assert.equal((await api.post('/products', { name: 'Basmati', price: '1' })).status, 201, 'archived names can be reused');
    assert.equal((await api.get('/products?status=archived')).body.total, 1);
  });

  test('validation: name and price required, units from the list, no negative numbers', async () => {
    const { api } = await newShop();
    assert.equal((await api.post('/products', { price: '1' })).status, 400);
    assert.equal((await api.post('/products', { name: 'X' })).status, 400);
    assert.equal((await api.post('/products', { name: 'X', price: '1', unit: 'bucket' })).status, 400);
    assert.equal((await api.post('/products', { name: 'X', price: '-1' })).status, 400);
    assert.equal((await api.post('/products', { name: 'X', price: '1', openingStock: '-3' })).status, 400);
  });

  test('search and the low-stock list', async () => {
    const { api } = await newShop();
    await product(api, { name: 'Sugar', lowStockAt: '12' }); // 10 <= 12 -> low
    await product(api, { name: 'Salt', lowStockAt: '5' });
    await product(api, { name: 'Soap', trackStock: false, openingStock: '' });
    assert.equal((await api.get('/products?search=sug')).body.total, 1);
    const low = (await api.get('/products?status=low')).body.data.map((p: any) => p.name);
    assert.deepEqual(low, ['Sugar']);
    assert.equal((await api.get('/products/low-stock-count')).body.count, 1);
  });
});

describe('stock entries', () => {
  test('receipt adds, write-off removes, stocktake records the difference from the count', async () => {
    const { api } = await newShop();
    const p = await product(api); // 10 kg
    await api.post(`/products/${p.id}/stock`, { kind: 'receipt', qty: '5.5', note: 'From supplier' });
    assert.equal(await stockOf(api, p.id), 15500);
    await api.post(`/products/${p.id}/stock`, { kind: 'write_off', qty: '0.5', note: 'Damaged' });
    assert.equal(await stockOf(api, p.id), 15000);
    const r = await api.post(`/products/${p.id}/stock`, { kind: 'stocktake', qty: '14.25' });
    assert.equal(r.body.stockMilli, 14250);
    assert.equal(r.body.movements[0].qtyMilli, -750);
    assert.equal(r.body.movements[0].balanceMilli, 14250);
    // counting the same again changes nothing
    assert.equal((await api.post(`/products/${p.id}/stock`, { kind: 'stocktake', qty: '14.25' })).status, 200);
  });

  test('cannot write off more than is in stock; retries do not double-count', async () => {
    const { api } = await newShop();
    const p = await product(api);
    assert.equal((await api.post(`/products/${p.id}/stock`, { kind: 'write_off', qty: '10.001' })).status, 400);
    const key = randomUUID();
    await Promise.all([1, 2].map(() => api.post(`/products/${p.id}/stock`, { kind: 'receipt', qty: '3', idempotencyKey: key })));
    assert.equal(await stockOf(api, p.id), 13000);
  });

  test('untracked products take no stock entries', async () => {
    const { api } = await newShop();
    const p = await product(api, { trackStock: false, openingStock: '' });
    assert.equal((await api.post(`/products/${p.id}/stock`, { kind: 'receipt', qty: '1' })).status, 409);
  });
});

describe('orders move stock', () => {
  test('creating, editing, cancelling, reopening and deleting an order keep stock right', async () => {
    const { api } = await newShop();
    const rice = await product(api, { name: 'Rice' }); // 10
    const dal = await product(api, { name: 'Dal', openingStock: '4' });
    const o = await newOrder(api, { items: [line(rice, '2.5'), { itemName: 'Free text bag', quantity: '1', unitPrice: '5' }] });
    assert.equal(await stockOf(api, rice.id), 7500);
    assert.equal(o.items[0].productId, rice.id);
    assert.equal(o.items[1].productId, null);

    // edit: more rice, add dal
    await api.put(`/orders/${o.id}`, { items: [line(rice, '4'), line(dal, '1')], discount: '0' });
    assert.equal(await stockOf(api, rice.id), 6000);
    assert.equal(await stockOf(api, dal.id), 3000);
    // edit: remove the rice line
    await api.put(`/orders/${o.id}`, { items: [line(dal, '1')], discount: '0' });
    assert.equal(await stockOf(api, rice.id), 10000);

    await api.patch(`/orders/${o.id}/status`, { status: 'cancelled' });
    assert.equal(await stockOf(api, dal.id), 4000, 'cancel puts stock back');
    await api.patch(`/orders/${o.id}/status`, { status: 'open' });
    assert.equal(await stockOf(api, dal.id), 3000, 'reopen takes it again');
    await api.del(`/orders/${o.id}`);
    assert.equal(await stockOf(api, dal.id), 4000, 'delete puts stock back');
    const hist = (await api.get(`/products/${dal.id}`)).body.movements;
    assert.match(hist[0].note, /ORD-\d+ deleted/);
  });

  test('an order needing more than is in stock is refused, and nothing is saved', async () => {
    const { api } = await newShop();
    const p = await product(api, { name: 'Ghee', unit: 'l', openingStock: '2' });
    const before = (await api.get('/orders')).body.total;
    const r = await api.post('/orders', { newCustomer: { name: 'X', phone: '9855555555' }, items: [line(p, '3')] });
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, 'INSUFFICIENT_STOCK');
    assert.match(r.body.error.message, /Ghee \(2 l left, 3 l needed\)/);
    assert.equal((await api.get('/orders')).body.total, before);
    assert.equal((await api.get('/customers?search=9855555555')).body.total, 0, 'the new customer was rolled back too');
    assert.equal(await stockOf(api, p.id), 2000);
  });

  test('reopening is refused if the stock has since been sold', async () => {
    const { api } = await newShop();
    const p = await product(api, { openingStock: '1' });
    const a = await newOrder(api, { items: [line(p, '1')] });
    await api.patch(`/orders/${a.id}/status`, { status: 'cancelled' });
    await newOrder(api, { items: [line(p, '1')] });
    const r = await api.patch(`/orders/${a.id}/status`, { status: 'open' });
    assert.equal(r.status, 409);
    assert.equal((await api.get(`/orders/${a.id}`)).body.status, 'cancelled');
  });

  test('two orders for the last unit at the same moment: exactly one succeeds', async () => {
    const { api } = await newShop();
    const p = await product(api, { openingStock: '1' });
    const c = await newOrder(api);
    const results = await Promise.all(
      [1, 2].map(() => api.post('/orders', { customerId: c.customerId, items: [line(p, '1')] })),
    );
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
    assert.equal(await stockOf(api, p.id), 0);
  });

  test('with "allow selling below zero" on, the sale goes through and shows as low stock', async () => {
    const { api } = await newShop();
    const shop = (await api.get('/shop')).body;
    await api.put('/shop', { ...shop, allowNegativeStock: true });
    const p = await product(api, { openingStock: '1' });
    await newOrder(api, { items: [line(p, '3')] });
    assert.equal(await stockOf(api, p.id), -2000);
    assert.ok((await api.get(`/products/${p.id}`)).body.low);
  });

  test('untracked products and free-text lines never move stock', async () => {
    const { api } = await newShop();
    const p = await product(api, { trackStock: false, openingStock: '' });
    await newOrder(api, { items: [line(p, '100')] });
    assert.equal(await stockOf(api, p.id), 0);
    assert.equal((await api.get(`/products/${p.id}`)).body.movements.length, 0);
  });

  test('deleting a customer with all their orders puts the stock back', async () => {
    const { api } = await newShop();
    const p = await product(api);
    const o = await newOrder(api, { items: [line(p, '4')] });
    await api.del(`/customers/${o.customerId}?purge=true`);
    assert.equal(await stockOf(api, p.id), 10000);
  });

  test('editing a product never changes past orders or invoices', async () => {
    const { api } = await newShop();
    const p = await product(api, { name: 'Tea' });
    const o = await newOrder(api, { items: [line(p, '1', '50')] });
    const inv = (await api.post(`/orders/${o.id}/invoice`)).body;
    await api.put(`/products/${p.id}`, { name: 'Premium Tea', unit: 'kg', price: '80' });
    const order = (await api.get(`/orders/${o.id}`)).body;
    assert.equal(order.items[0].itemName, 'Tea');
    assert.equal(order.items[0].unitPricePaise, 5000);
    assert.equal((await api.get(`/invoices/${inv.id}`)).body.itemsSnapshot[0].itemName, 'Tea');
  });
});

describe('products are shop-private', () => {
  test('another shop cannot see, change, stock or sell your products', async () => {
    const a = await newShop('A');
    const b = await newShop('B');
    const p = await product(a.api);
    assert.equal((await b.api.get(`/products/${p.id}`)).status, 404);
    assert.equal((await b.api.put(`/products/${p.id}`, { name: 'X', price: '1' })).status, 404);
    assert.equal((await b.api.patch(`/products/${p.id}/active`, { active: false })).status, 404);
    assert.equal((await b.api.post(`/products/${p.id}/stock`, { kind: 'receipt', qty: '1' })).status, 404);
    assert.equal((await b.api.get('/products')).body.total, 0);
    const r = await b.api.post('/orders', { newCustomer: { name: 'X', phone: '9866666666' }, items: [line(p, '1')] });
    assert.equal(r.status, 400);
    assert.equal(await stockOf(a.api, p.id), 10000);
  });
});
