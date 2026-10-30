import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { Client, newOrder, newShop, start, stop } from './helpers';

before(start);
after(stop);

const walkIn = (api: Client, body: Record<string, unknown> = {}) =>
  api.post('/orders', { walkIn: true, items: [{ itemName: 'Pen', quantity: '2', unitPrice: '10' }], amountPaid: '20', paymentMethod: 'cash', ...body });

describe('walk-in sales', () => {
  test('an order can be saved without a customer', async () => {
    const { api } = await newShop();
    const r = await walkIn(api);
    assert.equal(r.status, 201);
    assert.equal(r.body.customerId, null);
    assert.equal(r.body.customer, null);
    assert.equal(r.body.paymentStatus, 'paid');
    assert.equal(r.body.payments[0].method, 'cash');
  });

  test('exactly one of: existing customer, new customer, walk-in', async () => {
    const { api } = await newShop();
    const c = await newOrder(api);
    assert.equal((await walkIn(api, { customerId: c.customerId })).status, 400);
    assert.equal((await walkIn(api, { newCustomer: { name: 'X', phone: '9822200001' } })).status, 400);
    assert.equal((await api.post('/orders', { items: [{ itemName: 'Pen', quantity: '1', unitPrice: '1' }] })).status, 400);
  });

  test('lists, search and the dashboard show it as "Walk-in"', async () => {
    const { api } = await newShop();
    const o = (await walkIn(api, { amountPaid: '0' })).body;
    const row = (await api.get('/orders')).body.data[0];
    assert.equal(row.customerName, 'Walk-in');
    assert.equal(row.customerId, null);
    assert.equal((await api.get('/orders?search=walk')).body.total, 1);
    assert.deepEqual((await api.get('/orders?due=true')).body.data.map((x: any) => x.id), [o.id]);
  });

  test('invoice, PDF, payments, refunds and editing work without a customer', async () => {
    const { api } = await newShop();
    const o = (await walkIn(api, { amountPaid: '5' })).body;
    const inv = (await api.post(`/orders/${o.id}/invoice`)).body;
    assert.equal(inv.customerSnapshot.name, 'Walk-in customer');
    assert.equal(inv.customerSnapshot.phone, null);
    assert.equal((await api.get(`/invoices/${inv.id}/pdf`)).status, 200);
    assert.equal((await api.get('/invoices')).body.data[0].customerName, 'Walk-in customer');
    assert.equal((await api.post(`/orders/${o.id}/payments`, { amount: '15', method: 'upi' })).body.status, 'completed');
    assert.equal((await api.post(`/orders/${o.id}/payments`, { kind: 'refund', amount: '5', method: 'upi' })).status, 201);
    const edited = await api.put(`/orders/${o.id}`, { items: [{ itemName: 'Pen', quantity: '3', unitPrice: '10' }], discount: '0' });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.customer, null);
  });

  test('walk-ins count as sales, never as a customer', async () => {
    const { api } = await newShop();
    await walkIn(api);
    await walkIn(api);
    await newOrder(api); // one real customer, ₹100
    const a = (await api.get('/dashboard/analytics?days=7')).body;
    assert.equal(a.summary.orders, 3);
    assert.equal(a.summary.revenuePaise, 14000);
    assert.equal(a.summary.activeCustomers, 1);
    assert.equal(a.topCustomers.length, 1);
    const c = (await api.get('/customers/summary')).body;
    assert.equal(c.avgGapDays, 0, 'walk-ins are not one "customer" with visit gaps');
  });

  test('stock moves for walk-in sales too', async () => {
    const { api } = await newShop();
    const p = (await api.post('/products', { name: 'Notebook', price: '40', openingStock: '5' })).body;
    await walkIn(api, { items: [{ itemName: 'Notebook', quantity: '2', unitPrice: '40', productId: p.id }], amountPaid: '80' });
    assert.equal((await api.get(`/products/${p.id}`)).body.stockMilli, 3000);
  });
});
