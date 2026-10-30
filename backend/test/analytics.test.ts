import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { newOrder, newShop, sql, start, stop } from './helpers';

before(start);
after(stop);

const istToday = async () => (await sql(`SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date::text AS d`))[0].d as string;
const daysAgo = async (n: number) => (await sql(`SELECT ((now() AT TIME ZONE 'Asia/Kolkata')::date - $1::int)::text AS d`, [n]))[0].d as string;

describe('analytics reconcile with a known fixture', () => {
  test('KPIs, payment breakdown and top lists match hand-calculated values', async () => {
    const { api } = await newShop();
    const today = await istToday();
    // Fixture (all inside the 30-day window):
    //  A: 100, paid 100           B: 200, paid 50 (partial)     C: 300, unpaid
    //  D: 400, paid 400, then cancelled (must be excluded from money)
    //  E: 50, 40 days ago (previous window only)
    const a = await newOrder(api, { amountPaid: '100', orderDate: today });
    const b = await newOrder(api, { items: [{ itemName: 'Oil', quantity: '1', unitPrice: '200' }], amountPaid: '50', customerId: a.customerId, orderDate: today });
    await newOrder(api, { items: [{ itemName: 'Sugar', quantity: '3', unitPrice: '100' }], orderDate: await daysAgo(3) });
    const d = await newOrder(api, { items: [{ itemName: 'Ghee', quantity: '1', unitPrice: '400' }], amountPaid: '400', orderDate: await daysAgo(5) });
    await api.patch(`/orders/${d.id}/status`, { status: 'cancelled' });
    await newOrder(api, { items: [{ itemName: 'Salt', quantity: '1', unitPrice: '50' }], orderDate: await daysAgo(40) });

    const r = (await api.get('/dashboard/analytics?days=30')).body;
    assert.equal(r.summary.revenuePaise, 60000);
    assert.equal(r.summary.orders, 3);
    assert.equal(r.summary.collectedPaise, 15000);
    assert.equal(r.summary.outstandingPaise, 45000);
    assert.equal(r.summary.prevRevenuePaise, 5000);
    assert.equal(r.summary.prevOrders, 1);
    assert.equal(r.summary.activeCustomers, 2);

    const pay = Object.fromEntries(r.payment.map((p: any) => [p.status, p]));
    assert.equal(pay.paid.orders, 1);
    assert.equal(pay.partial.duePaise, 15000);
    assert.equal(pay.unpaid.duePaise, 30000);

    assert.equal(r.daily.length, 30);
    assert.equal(r.daily.reduce((t: number, x: any) => t + x.revenuePaise, 0), 60000);
    assert.equal(r.topCustomers[0].revenuePaise, 30000); // A's customer: 100 + 200
    assert.equal(r.topItems[0].name, 'Sugar');
    assert.ok(!r.topItems.some((i: any) => i.name === 'Ghee'), 'cancelled items excluded');

    // order list for the same window agrees with the KPI
    const from = await daysAgo(29);
    const list = (await api.get(`/orders?from=${from}&to=${today}&pageSize=100`)).body;
    const live = list.data.filter((o: any) => o.status !== 'cancelled');
    assert.equal(live.length, r.summary.orders);
    assert.equal(live.reduce((t: number, o: any) => t + o.totalPaise, 0), r.summary.revenuePaise);
    void b;
  });

  test('an empty shop returns zeros, not errors', async () => {
    const { api } = await newShop();
    const r = (await api.get('/dashboard/analytics?days=7')).body;
    assert.equal(r.summary.orders, 0);
    assert.equal(r.daily.length, 7);
    assert.deepEqual(r.topItems, []);
  });
});

describe('payments received are counted by payment date', () => {
  test('old orders paid recently count now; refunds subtract; removed entries do not count', async () => {
    const { api } = await newShop();
    const today = await istToday();
    const old = await newOrder(api, { orderDate: await daysAgo(40) }); // ₹100, outside the window
    await api.post(`/orders/${old.id}/payments`, { amount: '100', method: 'cash', paidOn: await daysAgo(1) });
    const fresh = await newOrder(api, { orderDate: today });
    await api.post(`/orders/${fresh.id}/payments`, { amount: '60', method: 'upi' });
    await api.post(`/orders/${fresh.id}/payments`, { kind: 'refund', amount: '10', method: 'upi' });
    const mistake = (await api.post(`/orders/${fresh.id}/payments`, { amount: '20', method: 'card' })).body.payments.at(-1);
    await api.post(`/orders/${fresh.id}/payments/${mistake.id}/void`, { reason: 'typo' });

    const r = (await api.get('/dashboard/analytics?days=7')).body;
    assert.equal(r.summary.receivedPaise, 10000 + 6000 - 1000);
    assert.equal(r.summary.revenuePaise, 10000); // only the fresh order is a sale in the window
    assert.equal(r.daily.find((d: any) => d.date === today).receivedPaise, 5000);
    assert.equal(r.daily.reduce((t: number, d: any) => t + d.receivedPaise, 0), r.summary.receivedPaise);

    // The summary window runs 10 pm -> 10 pm IST; after 10 pm, entries made now belong to tomorrow's.
    const [{ d: summaryDate }] = await sql(
      `SELECT (CASE WHEN extract(hour FROM now() AT TIME ZONE 'Asia/Kolkata') >= 22 THEN 1 ELSE 0 END
               + (now() AT TIME ZONE 'Asia/Kolkata')::date)::text AS d`,
    );
    const s = (await api.get(`/dashboard/daily-summary?date=${summaryDate}`)).body;
    assert.equal(s.refundedPaise, 1000);
    // The daily summary goes by when entries were made (like the rest of it), so the back-dated
    // payment entered just now counts here: 100 + 60 - 10, the removed entry excluded.
    assert.equal(s.receivedPaise, 15000);
  });
});
