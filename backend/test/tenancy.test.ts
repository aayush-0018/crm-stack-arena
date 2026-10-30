import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { client, newOrder, newShop, start, stop } from './helpers';

before(start);
after(stop);

describe('shops cannot see or change each other’s data', () => {
  test('every record of shop A is invisible to shop B', async () => {
    const a = await newShop('A');
    const b = await newShop('B');
    const order = await newOrder(a.api);
    const inv = (await a.api.post(`/orders/${order.id}/invoice`)).body;
    const cid = order.customerId;

    for (const p of [`/customers/${cid}`, `/customers/${cid}/orders`, `/orders/${order.id}`, `/invoices/${inv.id}`, `/invoices/${inv.id}/pdf`, `/orders/${order.id}/invoices`]) {
      assert.equal((await b.api.get(p)).status, 404, `GET ${p}`);
    }
    assert.equal((await b.api.put(`/customers/${cid}`, { name: 'Hacked', phone: '9876543210' })).status, 404);
    assert.equal((await b.api.patch(`/orders/${order.id}/payment`, { amountPaid: '1' })).status, 404);
    assert.equal((await b.api.patch(`/orders/${order.id}/status`, { status: 'cancelled' })).status, 404);
    assert.equal((await b.api.post(`/orders/${order.id}/invoice`)).status, 404);
    assert.equal((await b.api.del(`/orders/${order.id}`)).status, 404);
    assert.equal((await b.api.del(`/invoices/${inv.id}`)).status, 404);
    assert.equal((await b.api.del(`/customers/${cid}`)).status, 404);

    // B can't attach an order to A's customer
    const r = await b.api.post('/orders', { customerId: cid, items: [{ itemName: 'A', quantity: '1', unitPrice: '1' }] });
    assert.equal(r.status, 400);

    // lists and summaries are scoped
    assert.equal((await b.api.get('/orders')).body.total, 0);
    assert.equal((await b.api.get('/customers')).body.total, 0);
    assert.equal((await b.api.get('/invoices')).body.total, 0);
    assert.equal((await b.api.get('/dashboard/analytics?days=30')).body.summary.orders, 0);

    // A still sees its own data unchanged
    assert.equal((await a.api.get(`/orders/${order.id}`)).body.status, 'open');
  });

  test('switching to a branch you are not a member of is refused', async () => {
    const a = await newShop('A');
    const b = await newShop('B');
    assert.equal((await b.api.post('/auth/switch-branch', { shopId: a.shopId })).status, 404);
  });

  test('requests without a valid token are refused', async () => {
    assert.equal((await client().get('/orders')).status, 401);
    assert.equal((await client('not-a-token').get('/orders')).status, 401);
  });
});
