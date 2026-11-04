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

describe('growth (MoM, QoQ, YoY)', () => {
  test('like-for-like ranges handle short months, quarters and the last full period', async () => {
    const { comparisonRanges } = await import('../src/modules/reports/growth');
    const m = comparisonRanges('month', 'to_date', '2026-03-31');
    assert.deepEqual([m.current.from, m.current.to], ['2026-03-01', '2026-03-31']);
    assert.deepEqual([m.previous.from, m.previous.to], ['2026-02-01', '2026-02-28'], 'capped at the end of February');
    assert.deepEqual([m.lastYear.from, m.lastYear.to], ['2025-03-01', '2025-03-31']);
    const d = comparisonRanges('month', 'to_date', '2026-11-04');
    assert.deepEqual([d.previous.from, d.previous.to, d.previous.label], ['2026-10-01', '2026-10-04', 'Oct 2026 (to 4 Oct)']);
    const q = comparisonRanges('quarter', 'last_full', '2026-05-10');
    assert.deepEqual([q.current.from, q.current.to, q.current.label], ['2026-01-01', '2026-03-31', 'Q1 2026']);
    assert.deepEqual([q.previous.from, q.previous.to], ['2025-10-01', '2025-12-31']);
    assert.deepEqual([q.lastYear.from, q.lastYear.to], ['2025-01-01', '2025-03-31']);
    const y = comparisonRanges('year', 'to_date', '2026-02-10');
    assert.deepEqual([y.previous.from, y.previous.to], ['2025-01-01', '2025-02-10']);
  });

  test('sales, orders, customers and money received per period; cancelled and future orders left out', async () => {
    const { addMonths, startOf } = await import('../src/modules/reports/growth');
    const { api } = await newShop();
    const today = await daysFromToday(0);
    const thisMonth = startOf('month', today);
    const lastMonth = addMonths(thisMonth, -1);
    const lastYear = addMonths(thisMonth, -12);

    const a = await newOrder(api, { items: item('100'), amountPaid: '100' }); // today
    await newOrder(api, { items: item('300'), orderDate: thisMonth, customerId: a.customerId });
    await newOrder(api, { items: item('200'), orderDate: lastMonth, customerId: a.customerId });
    await newOrder(api, { items: item('50'), orderDate: lastYear });
    await newOrder(api, { items: item('999'), orderDate: await daysFromToday(2) }); // future: not yet
    const x = await newOrder(api, { items: item('700') });
    await api.patch(`/orders/${x.id}/status`, { status: 'cancelled' });
    await api.post('/orders', { walkIn: true, items: item('40'), discount: '0', amountPaid: '0' });

    const r = (await api.get('/reports/growth?grain=month&by=channel')).body;
    assert.equal(r.summary.current.revenuePaise, 10000 + 30000 + 4000);
    assert.equal(r.summary.current.orders, 3);
    assert.equal(r.summary.current.aovPaise, Math.round(44000 / 3));
    assert.equal(r.summary.current.customers, 1, 'walk-ins are not counted as customers');
    assert.equal(r.summary.current.receivedPaise, 10000);
    assert.equal(r.summary.previous.revenuePaise, 20000, 'the 1st of last month is always inside the like-for-like range');
    assert.equal(r.summary.lastYear.revenuePaise, 5000);
    assert.equal(r.summary.lastYear.newCustomers, 1);
    assert.equal(r.summary.previous.newCustomers, 1, "customer a's first order was last month");
    assert.equal(r.summary.current.newCustomers, 0);

    // Twelve months, oldest first, each carrying the month before and the same month last year.
    assert.equal(r.series.length, 12);
    const cur = r.series.at(-1);
    assert.equal(cur.start, thisMonth);
    assert.equal(cur.partial, true);
    assert.equal(cur.revenuePaise, 44000);
    assert.equal(cur.previous.revenuePaise, 20000);
    assert.equal(cur.lastYear.start, lastYear);
    assert.equal(cur.lastYear.revenuePaise, 5000);

    assert.deepEqual(
      r.breakdown.rows.map((b: any) => [b.label, b.current]),
      [['Customer orders', 40000], ['Walk-in sales', 4000]],
    );

    const full = (await api.get('/reports/growth?grain=month&basis=last_full&by=category')).body;
    assert.equal(full.ranges.current.from, lastMonth);
    assert.equal(full.summary.current.revenuePaise, 20000);
    assert.deepEqual(full.breakdown.rows[0], { label: 'No category', current: 20000, previous: 0, lastYear: 0 });

    const years = (await api.get('/reports/growth?grain=year&by=payment')).body;
    assert.equal(years.series.length, 5);
    assert.equal(years.breakdown.rows[0].current, 10000);
    assert.equal((await api.get('/reports/growth?grain=week')).status, 400);
  });

  test('another shop sees nothing', async () => {
    const a = await newShop();
    await newOrder(a.api, { items: item('100') });
    const b = await newShop('Other');
    const r = (await b.api.get('/reports/growth')).body;
    assert.equal(r.summary.current.revenuePaise, 0);
    assert.deepEqual(r.breakdown.rows, []);
  });
});
