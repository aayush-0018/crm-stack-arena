import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { newOrder, newShop, sql, start, stop } from './helpers';

before(start);
after(stop);

describe('order totals are computed on the server', () => {
  test('line totals round half-up and discount is applied', async () => {
    const { api } = await newShop();
    const o = await newOrder(api, {
      items: [
        { itemName: 'Cloth', quantity: '1.5', unitPrice: '33.33' }, // 49.995 -> 50.00
        { itemName: 'Thread', quantity: '3', unitPrice: '10' },
      ],
      discount: '5',
    });
    assert.equal(o.items[0].lineTotalPaise, 5000);
    assert.equal(o.subtotalPaise, 8000);
    assert.equal(o.discountPaise, 500);
    assert.equal(o.totalPaise, 7500);
  });

  test('client-sent totals are ignored', async () => {
    const { api } = await newShop();
    const r = await api.post('/orders', {
      newCustomer: { name: 'X', phone: '9811111111' },
      items: [{ itemName: 'A', quantity: '1', unitPrice: '10' }],
      totalPaise: 1,
      subtotal: 1,
    });
    assert.equal(r.status, 201);
    assert.equal(r.body.totalPaise, 1000);
  });

  test('discount above subtotal and paid above total are rejected', async () => {
    const { api } = await newShop();
    const base = { newCustomer: { name: 'X', phone: '9822222222' }, items: [{ itemName: 'A', quantity: '1', unitPrice: '10' }] };
    assert.equal((await api.post('/orders', { ...base, discount: '11' })).status, 400);
    assert.equal((await api.post('/orders', { ...base, amountPaid: '10.01' })).status, 400);
  });
});

describe('idempotency and numbering', () => {
  test('the same idempotency key returns the same order', async () => {
    const { api } = await newShop();
    const key = randomUUID();
    const body = { newCustomer: { name: 'Idem', phone: '9833333333' }, items: [{ itemName: 'A', quantity: '1', unitPrice: '1' }], idempotencyKey: key };
    const a = await api.post('/orders', body);
    const b = await api.post('/orders', body);
    assert.equal(a.status, 201);
    assert.equal(b.status, 200);
    assert.equal(a.body.id, b.body.id);
  });

  test('concurrent creation gives unique sequential numbers', async () => {
    const { api } = await newShop();
    const c = await newOrder(api);
    const results = await Promise.all(Array.from({ length: 10 }, () => newOrder(api, { customerId: c.customerId })));
    const numbers = results.map((o) => o.orderNumber).sort();
    assert.equal(new Set(numbers).size, 10);
    assert.deepEqual(numbers, Array.from({ length: 10 }, (_, i) => `ORD-${String(i + 2).padStart(6, '0')}`));
  });
});

describe('payments', () => {
  test('payment status follows the amount paid', async () => {
    const { api } = await newShop();
    const o = await newOrder(api); // total 100
    assert.equal(o.paymentStatus, 'unpaid');
    let r = await api.patch(`/orders/${o.id}/payment`, { amountPaid: '40' });
    assert.equal(r.body.paymentStatus, 'partial');
    r = await api.patch(`/orders/${o.id}/payment`, { amountPaid: '100' });
    assert.equal(r.body.paymentStatus, 'paid');
    r = await api.patch(`/orders/${o.id}/payment`, { amountPaid: '100.01' });
    assert.equal(r.status, 400);
  });

  test('cancelled orders cannot take payments until reopened', async () => {
    const { api } = await newShop();
    const o = await newOrder(api);
    await api.patch(`/orders/${o.id}/status`, { status: 'cancelled' });
    assert.equal((await api.patch(`/orders/${o.id}/payment`, { amountPaid: '10' })).status, 409);
    await api.patch(`/orders/${o.id}/status`, { status: 'open' });
    assert.equal((await api.patch(`/orders/${o.id}/payment`, { amountPaid: '10' })).status, 200);
  });

  test('a fully paid, invoiced order completes itself (either order of events)', async () => {
    const { api } = await newShop();
    const a = await newOrder(api);
    await api.post(`/orders/${a.id}/invoice`);
    assert.equal((await api.get(`/orders/${a.id}`)).body.status, 'open');
    assert.equal((await api.patch(`/orders/${a.id}/payment`, { amountPaid: '100' })).body.status, 'completed');

    const b = await newOrder(api, { amountPaid: '100' });
    assert.equal(b.status, 'open');
    await api.post(`/orders/${b.id}/invoice`);
    assert.equal((await api.get(`/orders/${b.id}`)).body.status, 'completed');
  });
});

describe('order deletion', () => {
  test('owner can delete an order; its items and invoices go with it', async () => {
    const { api } = await newShop();
    const o = await newOrder(api);
    await api.post(`/orders/${o.id}/invoice`);
    const r = await api.del(`/orders/${o.id}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.deletedInvoices, 1);
    assert.equal((await sql(`SELECT 1 FROM order_items WHERE order_id = $1`, [o.id])).length, 0);
  });
});
