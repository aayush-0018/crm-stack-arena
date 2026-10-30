import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { newOrder, newShop, sql, start, stop } from './helpers';

before(start);
after(stop);

const daysFromToday = async (n: number) =>
  (await sql(`SELECT ((now() AT TIME ZONE 'Asia/Kolkata')::date + $1::int)::text AS d`, [n]))[0].d as string;
const year = async () => (await daysFromToday(0)).slice(0, 4);
const item = (price: string) => [{ itemName: 'Item', quantity: '1', unitPrice: price }];
const lastEntry = (order: any) => order.payments.at(-1);

/** Every order's paid total equals its ledger, and every ledger entry has a receipt. */
async function ledgerInvariant(orderIds: number[]) {
  const bad = await sql(
    `SELECT o.id FROM orders o LEFT JOIN payments p ON p.order_id = o.id AND p.voided_at IS NULL
     WHERE o.id = ANY($1::bigint[]) GROUP BY o.id, o.amount_paid_paise
     HAVING o.amount_paid_paise <> COALESCE(sum(CASE WHEN p.kind = 'payment' THEN p.amount_paise ELSE -p.amount_paise END), 0)`,
    [orderIds],
  );
  assert.equal(bad.length, 0, 'paid totals match the ledger');
  const noReceipt = await sql(`SELECT id FROM payments WHERE order_id = ANY($1::bigint[]) AND receipt_id IS NULL`, [orderIds]);
  assert.equal(noReceipt.length, 0, 'every entry has a receipt');
}

describe('payment receipts', () => {
  test('a partial payment then another: two sequential branch receipts; reprints keep the number; retries never duplicate', async () => {
    const { api } = await newShop();
    const shop = (await api.get('/shop')).body;
    await api.put('/shop', { ...shop, code: 'JPR' });
    const o = await newOrder(api, { items: item('1000') });
    const key = randomUUID();
    const first = (await api.post(`/orders/${o.id}/payments`, { amount: '400', method: 'upi', reference: 'UTR123', idempotencyKey: key })).body;
    const again = await api.post(`/orders/${o.id}/payments`, { amount: '400', method: 'upi', reference: 'UTR123', idempotencyKey: key });
    assert.equal(again.status, 200, 'the retry is recognised');
    assert.equal(again.body.payments.length, 1);
    const second = (await api.post(`/orders/${o.id}/payments`, { amount: '600', method: 'cash' })).body;
    assert.equal(second.paymentStatus, 'paid');

    const y = await year();
    assert.equal(lastEntry(first).receiptNumber, `RCPT-JPR-${y}-000001`);
    assert.equal(lastEntry(second).receiptNumber, `RCPT-JPR-${y}-000002`);

    const r1 = (await api.get(`/receipts/${lastEntry(first).receiptId}`)).body;
    assert.deepEqual([r1.kind, r1.method, r1.reference, r1.amountPaise], ['payment', 'upi', 'UTR123', 40000]);
    assert.deepEqual(r1.allocations, [{ orderId: o.id, orderNumber: o.orderNumber, amountPaise: 40000 }]);
    assert.equal(r1.customerSnapshot.name, 'Cust');
    assert.equal(r1.shopSnapshot.code, 'JPR');

    // Reprint: same number and details, even after the shop and customer change.
    await api.put('/shop', { ...shop, code: 'JPR', name: 'Renamed shop' });
    await api.put(`/customers/${o.customerId}`, { name: 'Renamed customer', phone: o.customer?.phone ?? (await api.get(`/customers/${o.customerId}`)).body.phone });
    const reprint = (await api.get(`/receipts/${r1.id}`)).body;
    assert.equal(reprint.receiptNumber, r1.receiptNumber);
    assert.equal(reprint.shopSnapshot.name, r1.shopSnapshot.name);
    assert.equal(reprint.customerSnapshot.name, 'Cust');
    const pdf = await api.get(`/receipts/${r1.id}/pdf`);
    assert.equal(pdf.status, 200);
    assert.match(String(pdf.body).slice(0, 5), /%PDF-/);
    assert.equal((await sql(`SELECT count(*)::int AS n FROM receipts WHERE id = $1`, [r1.id]))[0].n, 1);
    await ledgerInvariant([o.id]);
  });

  test('refunds get their own RFND numbers; money taken with a new order and walk-ins get receipts', async () => {
    const { api } = await newShop();
    const y = await year();
    const o = await newOrder(api, { items: item('500'), amountPaid: '500' });
    assert.equal(lastEntry(o).receiptNumber, `RCPT-${y}-000001`);
    const refunded = (await api.post(`/orders/${o.id}/payments`, { kind: 'refund', amount: '100', method: 'upi' })).body;
    assert.equal(lastEntry(refunded).receiptNumber, `RFND-${y}-000001`);
    const rf = (await api.get(`/receipts/${lastEntry(refunded).receiptId}`)).body;
    assert.equal(rf.kind, 'refund');
    assert.equal((await api.get(`/receipts/${rf.id}/pdf`)).status, 200);

    const walk = (await api.post('/orders', { walkIn: true, items: item('50'), discount: '0', amountPaid: '50', paymentMethod: 'cash' })).body;
    const wr = (await api.get(`/receipts/${lastEntry(walk).receiptId}`)).body;
    assert.equal(wr.receiptNumber, `RCPT-${y}-000002`);
    assert.equal(wr.customerSnapshot.name, 'Walk-in customer');
    assert.equal(wr.customerId, null);

    // Cancelling with a refund issues a refund receipt too.
    const c = await newOrder(api, { items: item('80'), amountPaid: '80' });
    await api.patch(`/orders/${c.id}/status`, { status: 'cancelled', refund: { method: 'cash' } });
    const after = (await api.get(`/orders/${c.id}`)).body;
    assert.equal(lastEntry(after).receiptNumber, `RFND-${y}-000002`);
    await ledgerInvariant([o.id, walk.id, c.id]);
  });

  test('older entries without a receipt can be given one, once; removed entries show on the receipt; other shops see nothing', async () => {
    const { api, shopId } = await newShop();
    const o = await newOrder(api, { items: item('300') });
    const [p] = await sql(
      `INSERT INTO payments (shop_id, order_id, kind, amount_paise, method, paid_on) VALUES ($1, $2, 'payment', 10000, 'unrecorded', $3) RETURNING id`,
      [shopId, o.id, await daysFromToday(-3)],
    );
    await sql(`UPDATE orders SET amount_paid_paise = 10000, payment_status = 'partial' WHERE id = $1`, [o.id]);
    const a = (await api.post(`/orders/${o.id}/payments/${p.id}/receipt`)).body;
    const b = (await api.post(`/orders/${o.id}/payments/${p.id}/receipt`)).body;
    assert.equal(a.receiptId, b.receiptId);
    const r = (await api.get(`/receipts/${a.receiptId}`)).body;
    assert.equal(r.receiptDate, await daysFromToday(-3), 'dated on the payment date');

    await api.post(`/orders/${o.id}/payments/${p.id}/void`, { reason: 'mistake' });
    assert.equal((await api.get(`/receipts/${a.receiptId}`)).body.voidedPaise, 10000);
    assert.equal((await api.get(`/receipts/${a.receiptId}/pdf`)).status, 200);

    const other = await newShop('Other');
    assert.equal((await other.api.get(`/receipts/${a.receiptId}`)).status, 404);
    assert.equal((await other.api.get(`/receipts/${a.receiptId}/pdf`)).status, 404);
    assert.equal((await other.api.post(`/orders/${o.id}/payments/${p.id}/receipt`)).status, 404);
  });
});

describe('settle dues across orders', () => {
  test('one payment settles the oldest orders first, under one receipt; the preview saves nothing', async () => {
    const { api } = await newShop();
    const o1 = await newOrder(api, { items: item('100'), orderDate: await daysFromToday(-10) });
    const o2 = await newOrder(api, { items: item('200'), orderDate: await daysFromToday(-5), customerId: o1.customerId });
    const o3 = await newOrder(api, { items: item('300'), orderDate: await daysFromToday(-1), customerId: o1.customerId });
    const cancelled = await newOrder(api, { items: item('999'), orderDate: await daysFromToday(-20), customerId: o1.customerId });
    await api.patch(`/orders/${cancelled.id}/status`, { status: 'cancelled' });
    const someoneElse = await newOrder(api, { items: item('50'), orderDate: await daysFromToday(-30) });

    const preview = (await api.post(`/customers/${o1.customerId}/settle`, { amount: '250', method: 'upi', dryRun: true })).body;
    assert.equal(preview.totalDuePaise, 60000);
    assert.deepEqual(
      preview.allocations.map((a: any) => [a.orderId, a.allocatePaise, a.remainingPaise]),
      [[o1.id, 10000, 0], [o2.id, 15000, 5000], [o3.id, 0, 30000]],
    );
    assert.equal((await sql(`SELECT count(*)::int AS n FROM payments WHERE order_id = ANY($1::bigint[])`, [[o1.id, o2.id, o3.id]]))[0].n, 0);

    const key = randomUUID();
    const res = await api.post(`/customers/${o1.customerId}/settle`, { amount: '250', method: 'upi', reference: 'UTR9', idempotencyKey: key });
    assert.equal(res.status, 201);
    const rc = res.body.receipt;
    assert.equal(rc.amountPaise, 25000);
    assert.deepEqual(rc.allocations.map((a: any) => [a.orderNumber, a.amountPaise]), [[o1.orderNumber, 10000], [o2.orderNumber, 15000]]);
    assert.match(rc.receiptNumber, /^RCPT-\d{4}-000001$/);

    const entries = await sql(`SELECT order_id, amount_paise, reference, receipt_id FROM payments WHERE receipt_id = $1 ORDER BY order_id`, [rc.id]);
    assert.equal(entries.length, 2);
    assert.ok(entries.every((e: any) => e.reference === 'UTR9'), 'same payment reference on every allocation');
    assert.equal((await api.get(`/orders/${o1.id}`)).body.paymentStatus, 'paid');
    assert.equal((await api.get(`/orders/${o2.id}`)).body.paymentStatus, 'partial');
    assert.equal((await api.get(`/orders/${o3.id}`)).body.paymentStatus, 'unpaid');
    assert.equal((await api.get(`/orders/${someoneElse.id}`)).body.amountPaidPaise, 0, "another customer's order is untouched");
    assert.equal((await api.get(`/orders/${cancelled.id}`)).body.amountPaidPaise, 0, 'cancelled orders are skipped');

    // Retrying the same request returns the same receipt and collects nothing more.
    const retry = await api.post(`/customers/${o1.customerId}/settle`, { amount: '250', method: 'upi', reference: 'UTR9', idempotencyKey: key });
    assert.equal(retry.status, 200);
    assert.equal(retry.body.receipt.id, rc.id);
    assert.equal((await sql(`SELECT count(*)::int AS n FROM payments WHERE receipt_id = $1`, [rc.id]))[0].n, 2);

    // Overpaying is refused; paying exactly the rest settles everything.
    assert.equal((await api.post(`/customers/${o1.customerId}/settle`, { amount: '350.01', method: 'cash' })).status, 400);
    await api.post(`/customers/${o1.customerId}/settle`, { amount: '350', method: 'cash' });
    assert.equal((await api.post(`/customers/${o1.customerId}/settle`, { amount: '1', method: 'cash' })).status, 400, 'nothing due');
    await ledgerInvariant([o1.id, o2.id, o3.id, cancelled.id, someoneElse.id]);
    assert.equal((await api.get(`/receipts/${rc.id}/pdf`)).status, 200);
  });

  test('identical requests at once record one settlement', async () => {
    const { api } = await newShop();
    const o1 = await newOrder(api, { items: item('100') });
    await newOrder(api, { items: item('100'), customerId: o1.customerId });
    const key = randomUUID();
    const body = { amount: '150', method: 'cash', idempotencyKey: key };
    const rs = await Promise.all([1, 2, 3].map(() => api.post(`/customers/${o1.customerId}/settle`, body)));
    assert.ok(rs.every((r) => r.status === 200 || r.status === 201), JSON.stringify(rs.map((r) => r.status)));
    assert.equal(new Set(rs.map((r) => r.body.receipt.id)).size, 1);
    assert.equal((await sql(`SELECT count(*)::int AS n FROM receipts WHERE idempotency_key = $1`, [key]))[0].n, 1);
    assert.equal((await sql(`SELECT sum(p.amount_paise)::int AS s FROM payments p JOIN receipts r ON r.id = p.receipt_id WHERE r.idempotency_key = $1`, [key]))[0].s, 15000);
  });

  test('a settlement racing a single payment never overpays and never half-saves', async () => {
    const { api } = await newShop();
    const o1 = await newOrder(api, { items: item('100'), orderDate: await daysFromToday(-2) });
    const o2 = await newOrder(api, { items: item('100'), customerId: o1.customerId });
    const [settle, single] = await Promise.all([
      api.post(`/customers/${o1.customerId}/settle`, { amount: '200', method: 'cash' }),
      api.post(`/orders/${o1.id}/payments`, { amount: '100', method: 'upi' }),
    ]);
    const statuses = [settle.status, single.status].sort();
    assert.ok(statuses[0] === 201 && statuses[1] === 400, `one wins, one is refused: ${statuses}`);
    const paid = await sql(`SELECT sum(amount_paid_paise)::int AS s FROM orders WHERE id = ANY($1::bigint[])`, [[o1.id, o2.id]]);
    assert.equal(paid[0].s, settle.status === 201 ? 20000 : 10000);
    await ledgerInvariant([o1.id, o2.id]);
  });

  test('other shops and walk-ins', async () => {
    const { api } = await newShop();
    const o = await newOrder(api, { items: item('100') });
    const other = await newShop('Other');
    assert.equal((await other.api.post(`/customers/${o.customerId}/settle`, { amount: '10', method: 'cash' })).status, 404);
    assert.equal((await api.post(`/customers/${o.customerId}/settle`, { amount: '0', method: 'cash' })).status, 400);
    assert.equal((await api.post(`/customers/${o.customerId}/settle`, { amount: '10', method: 'cash', paidOn: await daysFromToday(1) })).status, 400);
  });
});
