import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { newOrder, newShop, sql, start, stop } from './helpers';

before(start);
after(stop);

const line = (itemName: string, quantity: string, unitPrice: string, productId?: number) => ({ itemName, quantity, unitPrice, productId });
const ret = (position: number, quantity: string, condition = 'saleable') => ({ position, quantity, condition });

async function invariants(orderIds: number[]) {
  const bad = await sql(
    `SELECT o.id FROM orders o LEFT JOIN payments p ON p.order_id = o.id AND p.voided_at IS NULL
     WHERE o.id = ANY($1::bigint[]) GROUP BY o.id, o.amount_paid_paise
     HAVING o.amount_paid_paise <> COALESCE(sum(CASE WHEN p.kind = 'payment' THEN p.amount_paise ELSE -p.amount_paise END), 0)`,
    [orderIds],
  );
  assert.equal(bad.length, 0, 'paid totals match the ledger');
  const totals = await sql(
    `SELECT o.id FROM orders o WHERE o.id = ANY($1::bigint[]) AND (o.returned_paise <> COALESCE((SELECT sum(value_paise) FROM order_returns r WHERE r.order_id = o.id), 0))`,
    [orderIds],
  );
  assert.equal(totals.length, 0, 'returned_paise equals the sum of the return documents');
}

describe('returns and return adjustments', () => {
  test('partial return on an invoiced, part-paid order: the balance drops, no refund, the invoice snapshot is untouched', async () => {
    const { api } = await newShop();
    const o = await newOrder(api, { items: [line('Shirt', '3', '100')] });
    await api.post(`/orders/${o.id}/payments`, { amount: '100', method: 'upi' });
    const inv = (await api.post(`/orders/${o.id}/invoice`)).body;

    const preview = (await api.post(`/orders/${o.id}/returns`, { items: [ret(1, '1')], dryRun: true })).body.preview;
    assert.deepEqual([preview.valuePaise, preview.totalAfterPaise, preview.refundPaise, preview.dueAfterPaise], [10000, 20000, 0, 10000]);
    assert.equal((await sql(`SELECT count(*)::int AS n FROM order_returns WHERE order_id = $1`, [o.id]))[0].n, 0, 'the preview saved nothing');

    const r = await api.post(`/orders/${o.id}/returns`, { items: [ret(1, '1')], reason: 'Wrong size' });
    assert.equal(r.status, 201);
    assert.match(r.body.return.returnNumber, /^RTN-\d{4}-000001$/);
    const after = r.body.order;
    assert.deepEqual([after.totalPaise, after.returnedPaise, after.amountPaidPaise, after.paymentStatus], [20000, 10000, 10000, 'partial']);
    assert.equal(after.items[0].quantity, '3.000', 'the order lines keep what was sold');
    assert.equal(after.returns.length, 1);

    const invAfter = (await api.get(`/invoices/${inv.id}`)).body;
    assert.deepEqual([invAfter.totalPaise, invAfter.status, invAfter.itemsSnapshot[0].quantity], [inv.totalPaise, 'issued', inv.itemsSnapshot[0].quantity]);
    assert.equal(after.invoice.outdated, false, 'a return does not ask for a reissue');
    const listed = (await api.get('/invoices')).body.data.find((i: any) => i.id === inv.id);
    assert.equal(listed.orderDuePaise, 10000, 'the outstanding invoice balance follows the return');
    assert.equal((await api.get(`/returns/${r.body.return.id}/pdf`)).status, 200);
    await invariants([o.id]);
  });

  test('returning more than is still owed refunds the excess to the original method, most recent first', async () => {
    const { api } = await newShop();
    const o = await newOrder(api, { items: [line('Bag', '3', '100')] });
    await api.post(`/orders/${o.id}/payments`, { amount: '50', method: 'cash' });
    await api.post(`/orders/${o.id}/payments`, { amount: '200', method: 'upi', reference: 'UTR1' });
    const r = (await api.post(`/orders/${o.id}/returns`, { items: [ret(1, '2')] })).body;
    assert.equal(r.return.valuePaise, 20000);
    assert.equal(r.return.refundPaise, 15000);
    assert.deepEqual(r.return.refunds.map((p: any) => [p.method, p.amountPaise]), [['upi', 15000]]);
    assert.match(r.return.refunds[0].receiptNumber, /^RFND-/);
    assert.deepEqual([r.order.totalPaise, r.order.amountPaidPaise, r.order.paymentStatus], [10000, 10000, 'paid']);

    // A refund larger than the newest method's share spills onto the next.
    const o2 = await newOrder(api, { items: [line('Bag', '2', '100')] });
    await api.post(`/orders/${o2.id}/payments`, { amount: '150', method: 'cash' });
    await api.post(`/orders/${o2.id}/payments`, { amount: '50', method: 'card' });
    const r2 = (await api.post(`/orders/${o2.id}/returns`, { items: [ret(1, '2')] })).body;
    assert.deepEqual(r2.return.refunds.map((p: any) => [p.method, p.amountPaise]), [['card', 5000], ['cash', 15000]]);
    // Or to a method chosen at the counter.
    const o3 = await newOrder(api, { items: [line('Bag', '1', '100')], amountPaid: '100' });
    const r3 = (await api.post(`/orders/${o3.id}/returns`, { items: [ret(1, '1')], refundMethod: 'bank' })).body;
    assert.deepEqual(r3.return.refunds.map((p: any) => p.method), ['bank']);
    await invariants([o.id, o2.id, o3.id]);
  });

  test('discount shares and rounding: returning everything always lands on exactly zero', async () => {
    const { api } = await newShop();
    const o = await newOrder(api, { items: [line('Pen', '2', '100')], discount: '20' });
    const r1 = (await api.post(`/orders/${o.id}/returns`, { items: [ret(1, '1')] })).body;
    assert.equal(r1.return.valuePaise, 9000, '₹100 less its ₹10 share of the discount');

    const odd = await newOrder(api, { items: [line('Clip', '3', '33.33')], discount: '10' });
    for (let i = 0; i < 3; i++) await api.post(`/orders/${odd.id}/returns`, { items: [ret(1, '1')] });
    const after = (await api.get(`/orders/${odd.id}`)).body;
    assert.deepEqual([after.totalPaise, after.returnedPaise, after.paymentStatus], [0, 8999, 'paid']);
    assert.equal((await api.post(`/orders/${odd.id}/returns`, { items: [ret(1, '1')] })).status, 400, 'nothing left to return');
    await invariants([o.id, odd.id]);
  });

  test('saleable items go back into stock; damaged ones are recorded but stay out', async () => {
    const { api } = await newShop();
    const p = (await api.post('/products', { name: 'Kurta', price: '500', openingStock: '10' })).body;
    const o = await newOrder(api, { items: [line('Kurta', '4', '500', p.id), line('Gift wrap', '1', '20')], amountPaid: '2020' });
    assert.equal((await api.get(`/products/${p.id}`)).body.stockMilli, 6000);
    const r = (await api.post(`/orders/${o.id}/returns`, { items: [ret(1, '1', 'saleable'), ret(1, '1', 'damaged')] })).body;
    const prod = (await api.get(`/products/${p.id}`)).body;
    assert.equal(prod.stockMilli, 7000, 'only the saleable one is back on the shelf');
    assert.equal(prod.movements[0].kind, 'return');
    assert.deepEqual(r.return.items.map((i: any) => i.condition), ['saleable', 'damaged']);
    assert.equal(r.return.refundPaise, 100000);

    assert.equal((await api.post(`/orders/${o.id}/returns`, { items: [ret(1, '3')] })).status, 400, 'only 2 left');
    assert.equal((await api.post(`/orders/${o.id}/returns`, { items: [ret(9, '1')] })).status, 400, 'not a line of this order');
    // The stock ledger still adds up.
    const [s] = await sql(`SELECT sum(qty_milli)::int AS s FROM stock_movements WHERE product_id = $1`, [p.id]);
    assert.equal(s.s, 7000);
    await invariants([o.id]);
  });

  test('after a return the order cannot be edited, cancelled or deleted; reports follow', async () => {
    const { api } = await newShop();
    const o = await newOrder(api, { items: [line('Rice', '2', '50')], amountPaid: '100' });
    await api.post(`/orders/${o.id}/returns`, { items: [ret(1, '2')] });
    assert.equal((await api.put(`/orders/${o.id}`, { items: [line('Rice', '1', '50')], discount: '0' })).status, 409);
    assert.equal((await api.patch(`/orders/${o.id}/status`, { status: 'cancelled' })).status, 409);
    assert.equal((await api.del(`/orders/${o.id}`)).status, 409);
    assert.equal((await api.del(`/customers/${o.customerId}?purge=true`)).status, 409);
    assert.equal((await api.patch(`/orders/${o.id}/status`, { status: 'completed' })).status, 200, 'completing is still fine');

    const a = (await api.get('/dashboard/analytics?days=7')).body;
    assert.equal(a.summary.revenuePaise, 0, 'sales are net of returns');
    assert.equal(a.summary.receivedPaise, 0, 'the refund offsets the payment');
    assert.equal(a.topItems.find((i: any) => i.name === 'Rice')?.revenuePaise ?? 0, 0, 'best-sellers drop returned items');
    const c = (await api.get('/reports/collections')).body;
    assert.deepEqual([c.totals.receivedPaise, c.totals.refundedPaise, c.totals.netPaise], [10000, 10000, 0]);
    assert.equal((await api.get('/reports/ageing')).body.totals.orders, 0);
  });

  test('walk-ins, cancelled orders, retries and other shops', async () => {
    const { api } = await newShop();
    const walk = (await api.post('/orders', { walkIn: true, items: [line('Soap', '2', '30')], discount: '0', amountPaid: '60', paymentMethod: 'cash' })).body;
    const wr = (await api.post(`/orders/${walk.id}/returns`, { items: [ret(1, '1')] })).body;
    assert.equal(wr.return.customer.name, 'Walk-in customer');
    assert.deepEqual(wr.return.refunds.map((p: any) => [p.method, p.amountPaise]), [['cash', 3000]]);

    const cancelled = await newOrder(api, { items: [line('X', '1', '10')] });
    await api.patch(`/orders/${cancelled.id}/status`, { status: 'cancelled' });
    assert.equal((await api.post(`/orders/${cancelled.id}/returns`, { items: [ret(1, '1')] })).status, 409);

    const o = await newOrder(api, { items: [line('Y', '5', '10')] });
    const key = randomUUID();
    const rs = await Promise.all([1, 2].map(() => api.post(`/orders/${o.id}/returns`, { items: [ret(1, '1')], idempotencyKey: key })));
    assert.deepEqual(rs.map((r) => r.status).sort(), [200, 201]);
    assert.equal((await sql(`SELECT count(*)::int AS n FROM order_returns WHERE order_id = $1`, [o.id]))[0].n, 1);
    assert.equal((await api.get(`/orders/${o.id}`)).body.totalPaise, 4000);

    const other = await newShop('Other');
    assert.equal((await other.api.post(`/orders/${o.id}/returns`, { items: [ret(1, '1')] })).status, 404);
    assert.equal((await other.api.get(`/returns/${wr.return.id}`)).status, 404);
    assert.equal((await other.api.get(`/returns/${wr.return.id}/pdf`)).status, 404);
    assert.equal((await api.post(`/orders/${o.id}/returns`, { items: [ret(1, '1')], returnDate: '2999-01-01' })).status, 400);
    await invariants([walk.id, o.id]);
  });
});
