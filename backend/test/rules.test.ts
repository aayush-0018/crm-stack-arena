import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { newOrder, newShop, sql, start, stop } from './helpers';

before(start);
after(stop);

const daysFromToday = async (n: number) =>
  (await sql(`SELECT ((now() AT TIME ZONE 'Asia/Kolkata')::date + $1::int)::text AS d`, [n]))[0].d as string;

describe('dates must be real calendar dates (400, never a server error)', () => {
  test('order date', async () => {
    const { api } = await newShop();
    const r = await api.post('/orders', { newCustomer: { name: 'X', phone: '9811100001' }, items: [{ itemName: 'A', quantity: '1', unitPrice: '1' }], orderDate: '2026-02-31' });
    assert.equal(r.status, 400);
    assert.ok(r.body.error.details.orderDate);
  });

  test('list filters and the daily summary', async () => {
    const { api } = await newShop();
    for (const p of ['/orders?from=2026-13-01', '/orders?to=2026-04-31', '/invoices?from=2026-00-10', '/dashboard/daily-summary?date=2026-02-30']) {
      assert.equal((await api.get(p)).status, 400, p);
    }
  });

  test('payment date', async () => {
    const { api } = await newShop();
    const o = await newOrder(api);
    assert.equal((await api.post(`/orders/${o.id}/payments`, { amount: '1', method: 'cash', paidOn: '2026-06-31' })).status, 400);
  });
});

describe('date windows end today', () => {
  test('a future-dated order is not counted in "last N days" until its date, and the KPI matches the daily series', async () => {
    const { api } = await newShop();
    await newOrder(api, { orderDate: await daysFromToday(0) }); // ₹100 today
    await newOrder(api, { orderDate: await daysFromToday(5), amountPaid: '100' }); // ₹100 in 5 days
    const r = (await api.get('/dashboard/analytics?days=30')).body;
    assert.equal(r.summary.revenuePaise, 10000);
    assert.equal(r.summary.orders, 1);
    assert.equal(r.daily.reduce((t: number, d: any) => t + d.revenuePaise, 0), r.summary.revenuePaise);
  });

  test('money taken when entering a future-dated order is received today, not in the future', async () => {
    const { api } = await newShop();
    const o = await newOrder(api, { orderDate: await daysFromToday(5), amountPaid: '40' });
    assert.equal(o.payments[0].paidOn, await daysFromToday(0));
    const r = (await api.get('/dashboard/analytics?days=7')).body;
    assert.equal(r.summary.receivedPaise, 4000);
  });

  test('a back-dated order keeps its payment on the order date', async () => {
    const { api } = await newShop();
    const o = await newOrder(api, { orderDate: await daysFromToday(-3), amountPaid: '40' });
    assert.equal(o.payments[0].paidOn, await daysFromToday(-3));
  });
});

describe('totals stay exact', () => {
  test('an order whose total is too large to calculate exactly is refused', async () => {
    const { api } = await newShop();
    const items = Array.from({ length: 200 }, (_, i) => ({ itemName: `I${i}`, quantity: '99999', unitPrice: '10000000' }));
    const r = await api.post('/orders', { newCustomer: { name: 'Big', phone: '9811100002' }, items });
    assert.equal(r.status, 400);
  });
});
