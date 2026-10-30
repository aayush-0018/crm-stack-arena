import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { newOrder, newShop, start, stop } from './helpers';

before(start);
after(stop);

describe('customers', () => {
  test('phone numbers are normalised and duplicates are blocked', async () => {
    const { api } = await newShop();
    const a = await api.post('/customers', { name: 'Asha', phone: '+91 98765-43210' });
    assert.equal(a.status, 201);
    assert.equal(a.body.phone, '9876543210');
    const dup = await api.post('/customers', { name: 'Asha 2', phone: '09876543210' });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error.details.existingCustomerId, a.body.id);
  });

  test('search finds by partial name and phone', async () => {
    const { api } = await newShop();
    await api.post('/customers', { name: 'Ramesh Kumar', phone: '9123456780' });
    assert.equal((await api.get('/customers?search=mesh')).body.total, 1);
    assert.equal((await api.get('/customers?search=34567')).body.total, 1);
    assert.equal((await api.get('/customers?search=zzz')).body.total, 0);
  });

  test('archiving a customer with orders keeps the orders and invoices', async () => {
    const { api } = await newShop();
    const o = await newOrder(api);
    await api.post(`/orders/${o.id}/invoice`);
    const r = await api.del(`/customers/${o.customerId}`);
    assert.equal(r.body.deleted, 'soft');
    assert.equal((await api.get(`/orders/${o.id}`)).status, 200);
    assert.equal((await api.get('/invoices')).body.total, 1);
  });

  test('totals exclude cancelled orders', async () => {
    const { api } = await newShop();
    const o1 = await newOrder(api, { amountPaid: '20' });
    const o2 = await newOrder(api, { customerId: o1.customerId });
    await api.patch(`/orders/${o2.id}/status`, { status: 'cancelled' });
    const c = (await api.get(`/customers/${o1.customerId}`)).body;
    assert.equal(c.stats.totalSpentPaise, 10000);
    assert.equal(c.stats.outstandingPaise, 8000);
    const row = (await api.get('/customers')).body.data[0];
    assert.equal(row.orderCount, 1);
    assert.equal(row.totalSpentPaise, 10000);
  });
});
