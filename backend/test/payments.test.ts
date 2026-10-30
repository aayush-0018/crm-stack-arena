import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { newOrder, newShop, sql, start, stop } from './helpers';

before(start);
after(async () => {
  // Invariant over everything the tests created: the order's paid total always equals the ledger.
  const drift = await sql(
    `SELECT o.id FROM orders o
     LEFT JOIN payments p ON p.order_id = o.id AND p.voided_at IS NULL
     GROUP BY o.id, o.amount_paid_paise
     HAVING o.amount_paid_paise <> COALESCE(sum(CASE WHEN p.kind = 'payment' THEN p.amount_paise ELSE -p.amount_paise END), 0)`,
  );
  assert.deepEqual(drift, [], 'orders whose paid total disagrees with the ledger');
  await stop();
});

const yesterday = async () => (await sql(`SELECT ((now() AT TIME ZONE 'Asia/Kolkata')::date - 1)::text AS d`))[0].d as string;
const tomorrow = async () => (await sql(`SELECT ((now() AT TIME ZONE 'Asia/Kolkata')::date + 1)::text AS d`))[0].d as string;

describe('recording payments', () => {
  test('each payment is its own entry; status follows the running total', async () => {
    const { api } = await newShop();
    const o = await newOrder(api); // ₹100
    let r = await api.post(`/orders/${o.id}/payments`, { amount: '40', method: 'cash' });
    assert.equal(r.status, 201);
    assert.equal(r.body.amountPaidPaise, 4000);
    assert.equal(r.body.paymentStatus, 'partial');
    r = await api.post(`/orders/${o.id}/payments`, { amount: '60', method: 'upi', reference: 'UPI123', paidOn: await yesterday() });
    assert.equal(r.body.paymentStatus, 'paid');
    assert.equal(r.body.payments.length, 2);
    assert.deepEqual(
      r.body.payments.map((p: any) => [p.kind, p.amountPaise, p.method]).sort(),
      [['payment', 4000, 'cash'], ['payment', 6000, 'upi']],
    );
    assert.equal(r.body.payments.find((p: any) => p.method === 'upi').reference, 'UPI123');
    assert.equal(r.body.payments[0].createdByName, 'Owner');
  });

  test('more than the balance due, nothing due, or a future date are refused', async () => {
    const { api } = await newShop();
    const o = await newOrder(api, { amountPaid: '70' });
    const over = await api.post(`/orders/${o.id}/payments`, { amount: '30.01', method: 'cash' });
    assert.equal(over.status, 400);
    assert.match(over.body.error.details.amount, /balance due/);
    assert.equal((await api.post(`/orders/${o.id}/payments`, { amount: '10', method: 'cash', paidOn: await tomorrow() })).status, 400);
    await api.post(`/orders/${o.id}/payments`, { amount: '30', method: 'cash' });
    assert.equal((await api.post(`/orders/${o.id}/payments`, { amount: '1', method: 'cash' })).status, 400);
    assert.equal((await api.post(`/orders/${o.id}/payments`, { amount: '0', method: 'cash' })).status, 400);
    assert.equal((await api.post(`/orders/${o.id}/payments`, { amount: '5', method: 'bitcoin' })).status, 400);
  });

  test('a retried request with the same key records only one payment', async () => {
    const { api } = await newShop();
    const o = await newOrder(api);
    const body = { amount: '25', method: 'cash', idempotencyKey: randomUUID() };
    const [a, b] = await Promise.all([api.post(`/orders/${o.id}/payments`, body), api.post(`/orders/${o.id}/payments`, body)]);
    assert.deepEqual([a.status, b.status].sort(), [200, 201]);
    const order = (await api.get(`/orders/${o.id}`)).body;
    assert.equal(order.payments.length, 1);
    assert.equal(order.amountPaidPaise, 2500);
  });

  test('the payment taken when creating an order is in the ledger with its method', async () => {
    const { api } = await newShop();
    const r = await api.post('/orders', {
      newCustomer: { name: 'P', phone: '9844444444' },
      items: [{ itemName: 'A', quantity: '1', unitPrice: '100' }],
      amountPaid: '30',
      paymentMethod: 'upi',
    });
    assert.equal(r.body.payments.length, 1);
    assert.equal(r.body.payments[0].method, 'upi');
    assert.equal(r.body.payments[0].amountPaise, 3000);
  });

  test('cancelled orders take no payments, but refunds are allowed', async () => {
    const { api } = await newShop();
    const o = await newOrder(api, { amountPaid: '50' });
    await api.patch(`/orders/${o.id}/status`, { status: 'cancelled' });
    assert.equal((await api.post(`/orders/${o.id}/payments`, { amount: '10', method: 'cash' })).status, 409);
    const r = await api.post(`/orders/${o.id}/payments`, { kind: 'refund', amount: '50', method: 'cash' });
    assert.equal(r.status, 201);
    assert.equal(r.body.amountPaidPaise, 0);
    assert.equal(r.body.paymentStatus, 'unpaid');
  });
});

describe('refunds', () => {
  test('cannot refund more than was paid', async () => {
    const { api } = await newShop();
    const o = await newOrder(api, { amountPaid: '40' });
    const r = await api.post(`/orders/${o.id}/payments`, { kind: 'refund', amount: '40.01', method: 'cash' });
    assert.equal(r.status, 400);
    const ok = await api.post(`/orders/${o.id}/payments`, { kind: 'refund', amount: '15', method: 'cash' });
    assert.equal(ok.body.amountPaidPaise, 2500);
    assert.equal(ok.body.paymentStatus, 'partial');
  });

  test('cancelling with "refund" returns everything paid in one entry and voids the invoice', async () => {
    const { api } = await newShop();
    const o = await newOrder(api, { amountPaid: '60' });
    const inv = (await api.post(`/orders/${o.id}/invoice`)).body;
    const r = await api.patch(`/orders/${o.id}/status`, { status: 'cancelled', refund: { method: 'upi' } });
    assert.equal(r.body.status, 'cancelled');
    assert.equal(r.body.amountPaidPaise, 0);
    const refund = r.body.payments.find((p: any) => p.kind === 'refund');
    assert.equal(refund.amountPaise, 6000);
    assert.equal(refund.method, 'upi');
    assert.equal((await api.get(`/invoices/${inv.id}`)).body.status, 'void');
  });

  test('cancelling without "refund" keeps the money recorded (as before)', async () => {
    const { api } = await newShop();
    const o = await newOrder(api, { amountPaid: '60' });
    const r = await api.patch(`/orders/${o.id}/status`, { status: 'cancelled' });
    assert.equal(r.body.amountPaidPaise, 6000);
  });
});

describe('removing a mistaken entry', () => {
  test('voided entries stay in the history and stop counting', async () => {
    const { api } = await newShop();
    const o = await newOrder(api);
    const p = (await api.post(`/orders/${o.id}/payments`, { amount: '100', method: 'card' })).body.payments[0];
    const r = await api.post(`/orders/${o.id}/payments/${p.id}/void`, { reason: 'Card declined' });
    assert.equal(r.status, 200);
    assert.equal(r.body.amountPaidPaise, 0);
    assert.equal(r.body.paymentStatus, 'unpaid');
    assert.equal(r.body.payments.length, 1);
    assert.ok(r.body.payments[0].voidedAt);
    assert.equal(r.body.payments[0].voidReason, 'Card declined');
    // voiding twice is harmless
    assert.equal((await api.post(`/orders/${o.id}/payments/${p.id}/void`, {})).status, 200);
  });

  test('a payment that was partly refunded cannot be removed before the refund', async () => {
    const { api } = await newShop();
    const o = await newOrder(api);
    const paid = (await api.post(`/orders/${o.id}/payments`, { amount: '100', method: 'cash' })).body.payments[0];
    await api.post(`/orders/${o.id}/payments`, { kind: 'refund', amount: '30', method: 'cash' });
    const r = await api.post(`/orders/${o.id}/payments/${paid.id}/void`, {});
    assert.equal(r.status, 409);
    assert.match(r.body.error.message, /Remove the refund first/);
    assert.equal((await api.get(`/orders/${o.id}`)).body.amountPaidPaise, 7000);
  });
});

describe('payments and invoices', () => {
  test('a payment after the invoice does not mark it "needs reissue"', async () => {
    const { api } = await newShop();
    const o = await newOrder(api);
    await api.post(`/orders/${o.id}/invoice`);
    await api.post(`/orders/${o.id}/payments`, { amount: '30', method: 'cash' });
    const order = (await api.get(`/orders/${o.id}`)).body;
    assert.equal(order.invoice.outdated, false);
    assert.equal((await api.get('/invoices?status=needs_reissue')).body.total, 0);
  });

  test('paying in full after invoicing completes the order', async () => {
    const { api } = await newShop();
    const o = await newOrder(api);
    await api.post(`/orders/${o.id}/invoice`);
    const r = await api.post(`/orders/${o.id}/payments`, { amount: '100', method: 'cash' });
    assert.equal(r.body.status, 'completed');
  });

  test('editing items still outdates the invoice', async () => {
    const { api } = await newShop();
    const o = await newOrder(api);
    await api.post(`/orders/${o.id}/invoice`);
    await api.put(`/orders/${o.id}`, { items: [{ itemName: 'Rice', quantity: '3', unitPrice: '50' }], discount: '0' });
    assert.equal((await api.get(`/orders/${o.id}`)).body.invoice.outdated, true);
  });
});

describe('edits and the older "total paid" API stay consistent with the ledger', () => {
  test('an edit without amountPaid leaves payments alone; lowering the total below what was paid is refused', async () => {
    const { api } = await newShop();
    const o = await newOrder(api, { amountPaid: '80' });
    let r = await api.put(`/orders/${o.id}`, { items: [{ itemName: 'Rice', quantity: '3', unitPrice: '50' }], discount: '0' });
    assert.equal(r.body.amountPaidPaise, 8000);
    assert.equal(r.body.payments.length, 1);
    r = await api.put(`/orders/${o.id}`, { items: [{ itemName: 'Rice', quantity: '1', unitPrice: '50' }], discount: '0' });
    assert.equal(r.status, 400);
  });

  test('PATCH /payment (total so far) records the difference as one entry', async () => {
    const { api } = await newShop();
    const o = await newOrder(api, { amountPaid: '20' });
    let r = await api.patch(`/orders/${o.id}/payment`, { amountPaid: '70' });
    assert.equal(r.body.amountPaidPaise, 7000);
    assert.equal(r.body.payments.at(-1).amountPaise, 5000);
    r = await api.patch(`/orders/${o.id}/payment`, { amountPaid: '50' });
    assert.equal(r.body.amountPaidPaise, 5000);
    assert.equal(r.body.payments.at(-1).kind, 'refund');
    assert.equal(r.body.payments.at(-1).method, 'unrecorded');
  });
});

describe('payments are shop-private', () => {
  test('another shop cannot add to or remove from your ledger', async () => {
    const a = await newShop('A');
    const b = await newShop('B');
    const o = await newOrder(a.api);
    const p = (await a.api.post(`/orders/${o.id}/payments`, { amount: '10', method: 'cash' })).body.payments[0];
    assert.equal((await b.api.post(`/orders/${o.id}/payments`, { amount: '10', method: 'cash' })).status, 404);
    assert.equal((await b.api.post(`/orders/${o.id}/payments/${p.id}/void`, {})).status, 404);
    assert.equal((await a.api.get(`/orders/${o.id}`)).body.amountPaidPaise, 1000);
  });
});
