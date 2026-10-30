import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { newOrder, newShop, sql, start, stop } from './helpers';

before(start);
after(stop);

const daysFromToday = async (n: number) =>
  (await sql(`SELECT ((now() AT TIME ZONE 'Asia/Kolkata')::date + $1::int)::text AS d`, [n]))[0].d as string;
const item = (price: string) => [{ itemName: 'Item', quantity: '1', unitPrice: price }];

describe('outstanding and ageing report', () => {
  test('buckets by days since the order date; cancelled and settled orders are left out', async () => {
    const { api } = await newShop();
    const fresh = await newOrder(api, { items: item('100'), orderDate: await daysFromToday(-30) }); // 30 days: 0-30
    const d45 = await newOrder(api, { items: item('200'), amountPaid: '50', orderDate: await daysFromToday(-31) }); // 31-60
    const d75 = await newOrder(api, { items: item('300'), orderDate: await daysFromToday(-61), customerId: fresh.customerId }); // 61-90
    await newOrder(api, { items: item('400'), orderDate: await daysFromToday(-91), customerId: fresh.customerId }); // 90+
    const future = await newOrder(api, { items: item('10'), orderDate: await daysFromToday(3) }); // future: age 0
    await newOrder(api, { items: item('500'), amountPaid: '500' }); // settled
    const cancelled = await newOrder(api, { items: item('600') });
    await api.patch(`/orders/${cancelled.id}/status`, { status: 'cancelled' });
    const walkIn = (await api.post('/orders', { walkIn: true, items: item('70'), discount: '0', amountPaid: '20' })).body;

    const r = (await api.get('/reports/ageing')).body;
    assert.deepEqual(
      { b1: r.totals['0-30'], b2: r.totals['31-60'], b3: r.totals['61-90'], b4: r.totals['90+'] },
      { b1: 10000 + 1000 + 5000, b2: 15000, b3: 30000, b4: 40000 },
    );
    assert.equal(r.totals.totalPaise, 101000);
    assert.equal(r.totals.orders, 6);
    assert.equal(r.orders.find((o: any) => o.id === future.id).ageDays, 0);
    assert.equal(r.orders.find((o: any) => o.id === d45.id).duePaise, 15000);

    // One row per customer; walk-ins grouped; the customer's buckets add up to their total.
    const cust = r.customers.find((c: any) => c.customerId === fresh.customerId);
    assert.equal(cust.orders, 3);
    assert.equal(cust.totalPaise, 10000 + 30000 + 40000);
    assert.equal(cust['0-30'] + cust['31-60'] + cust['61-90'] + cust['90+'], cust.totalPaise);
    assert.equal(r.customers.find((c: any) => c.customerId === null).customerName, 'Walk-in sales');
    assert.ok(r.orders.some((o: any) => o.id === walkIn.id));
    assert.equal(r.customers[0].customerId, fresh.customerId, 'largest balance first');

    // The order-date filter, and drill-down to the invoice.
    const inv = (await api.post(`/orders/${d75.id}/invoice`)).body;
    const f = (await api.get(`/reports/ageing?from=${await daysFromToday(-70)}&to=${await daysFromToday(-40)}`)).body;
    assert.deepEqual(f.orders.map((o: any) => o.id), [d75.id]);
    assert.equal(f.orders[0].invoiceNumber, inv.invoiceNumber);
    assert.equal(f.totals.totalPaise, 30000);

    // Matches an independent sum over the order table.
    const [due] = await sql(
      `SELECT sum(o.total_paise - o.amount_paid_paise)::bigint AS due FROM orders o
       JOIN shops s ON s.id = o.shop_id WHERE o.id = ANY($1::bigint[]) AND o.status <> 'cancelled'`,
      [r.orders.map((x: any) => x.id).concat([cancelled.id])],
    );
    assert.equal(r.totals.totalPaise, Number(due.due));
  });

  test('another shop sees nothing', async () => {
    const a = await newShop();
    await newOrder(a.api, { items: item('100') });
    const b = await newShop('Other');
    const r = (await b.api.get('/reports/ageing')).body;
    assert.equal(r.totals.orders, 0);
  });
});

describe('collections (payment reconciliation)', () => {
  test('₹10,000 UPI then a ₹2,000 refund nets ₹8,000; split by date and method; removed entries excluded', async () => {
    const { api } = await newShop();
    const o = await newOrder(api, { items: item('10000') });
    await api.post(`/orders/${o.id}/payments`, { amount: '10000', method: 'upi', reference: 'UPI-1' });
    await api.post(`/orders/${o.id}/payments`, { kind: 'refund', amount: '2000', method: 'upi' });
    const o2 = await newOrder(api, { items: item('500') });
    await api.post(`/orders/${o2.id}/payments`, { amount: '300', method: 'cash', paidOn: await daysFromToday(-2) });
    const mistake = (await api.post(`/orders/${o2.id}/payments`, { amount: '100', method: 'card' })).body.payments.at(-1);
    await api.post(`/orders/${o2.id}/payments/${mistake.id}/void`, { reason: 'wrong' });

    const r = (await api.get(`/reports/collections?from=${await daysFromToday(-6)}&to=${await daysFromToday(0)}`)).body;
    const upi = r.byMethod.find((m: any) => m.method === 'upi');
    assert.deepEqual([upi.receivedPaise, upi.refundedPaise, upi.netPaise], [1000000, 200000, 800000]);
    assert.equal(r.byMethod.find((m: any) => m.method === 'cash').netPaise, 30000);
    assert.equal(r.byMethod.find((m: any) => m.method === 'card'), undefined, 'a removed payment is not counted');
    assert.equal(r.totals.netPaise, 830000);
    assert.equal(r.totals.receivedPaise - r.totals.refundedPaise, r.totals.netPaise);
    assert.equal(r.byDate.length, 2);
    assert.equal(r.byDate.reduce((s: number, d: any) => s + d.netPaise, 0), r.totals.netPaise);

    // Reconciles with the ledger itself and with the analytics "Payments received" for the same window.
    const [ledger] = await sql(
      `SELECT sum(CASE WHEN kind = 'payment' THEN amount_paise ELSE -amount_paise END)::bigint AS net
       FROM payments WHERE order_id = ANY($1::bigint[]) AND voided_at IS NULL`,
      [[o.id, o2.id]],
    );
    assert.equal(r.totals.netPaise, Number(ledger.net));
    const a = (await api.get('/dashboard/analytics?days=7')).body;
    assert.equal(a.summary.receivedPaise, r.totals.netPaise);

    // A window that excludes 2 days ago drops the cash payment.
    const today = (await api.get(`/reports/collections?from=${await daysFromToday(0)}&to=${await daysFromToday(0)}`)).body;
    assert.equal(today.totals.netPaise, 800000);
  });

  test('bad ranges are refused', async () => {
    const { api } = await newShop();
    assert.equal((await api.get(`/reports/collections?from=${await daysFromToday(0)}&to=${await daysFromToday(-1)}`)).status, 400);
    assert.equal((await api.get(`/reports/collections?from=${await daysFromToday(-400)}&to=${await daysFromToday(0)}`)).status, 400);
    assert.equal((await api.get(`/reports/collections?from=2026-02-31`)).status, 400);
  });
});
