import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { client, newOrder, newShop, sql, start, stop } from './helpers';

before(start);
after(stop);

const istDay = async (n = 0) => (await sql(`SELECT ((now() AT TIME ZONE 'Asia/Kolkata')::date + $1::int)::text AS d`, [n]))[0].d as string;

describe('expenses', () => {
  test('add, list by month with category totals and sales, edit and delete', async () => {
    const { api } = await newShop();
    const today = await istDay();
    const month = today.slice(0, 7);
    const rent = await api.post('/expenses', { spentOn: today, category: 'Rent', amount: '15000', method: 'bank', note: 'November rent' });
    assert.equal(rent.status, 201, JSON.stringify(rent.body));
    assert.equal(rent.body.amountPaise, 1500000);
    await api.post('/expenses', { spentOn: today, category: 'Tea & snacks', amount: '40.50' });
    await api.post('/expenses', { spentOn: today, category: 'Tea & snacks', amount: '20' });
    await api.post('/expenses', { spentOn: '2020-01-15', category: 'Old', amount: '10' });
    await newOrder(api, { items: [{ itemName: 'Rice', quantity: '1', unitPrice: '500' }], orderDate: today });

    const r = (await api.get(`/expenses?month=${month}`)).body;
    assert.equal(r.rows.length, 3, 'only this month');
    assert.equal(r.totalPaise, 1500000 + 4050 + 2000);
    assert.deepEqual(r.byCategory.map((c: any) => [c.category, c.totalPaise, c.count]), [
      ['Rent', 1500000, 1],
      ['Tea & snacks', 6050, 2],
    ]);
    assert.equal(r.salesPaise, 50000);
    assert.equal(r.categories[0], 'Tea & snacks', 'most used first');
    assert.ok(r.categories.includes('Electricity'), 'default suggestions follow');
    assert.equal(r.rows[0].method, 'cash', 'cash by default');

    const e = await api.put(`/expenses/${rent.body.id}`, { spentOn: today, category: 'Rent', amount: '16000', method: 'upi' });
    assert.deepEqual([e.body.amountPaise, e.body.method, e.body.note], [1600000, 'upi', null]);
    assert.equal((await api.del(`/expenses/${rent.body.id}`)).status, 204);
    assert.equal((await api.get(`/expenses?month=${month}`)).body.rows.length, 2);
    assert.equal((await api.del(`/expenses/${rent.body.id}`)).status, 404);
  });

  test('bad input and future dates are refused; other shops can’t see or touch them', async () => {
    const { api } = await newShop();
    const bad = await api.post('/expenses', { spentOn: await istDay(), category: '', amount: '0' });
    assert.equal(bad.status, 400);
    const future = await api.post('/expenses', { spentOn: await istDay(2), category: 'Rent', amount: '10' });
    assert.equal(future.status, 400);
    assert.match(JSON.stringify(future.body), /future/);

    const x = (await api.post('/expenses', { spentOn: await istDay(), category: 'Rent', amount: '10' })).body;
    const other = await newShop();
    assert.equal((await other.api.get('/expenses')).body.rows.length, 0);
    assert.equal((await other.api.put(`/expenses/${x.id}`, { spentOn: await istDay(), category: 'X', amount: '1' })).status, 404);
    assert.equal((await other.api.del(`/expenses/${x.id}`)).status, 404);
  });

  test('staff can add expenses but only owners edit or delete them', async () => {
    const owner = await newShop();
    const helper = await newShop();
    await sql(`INSERT INTO shop_members (user_id, shop_id, role) SELECT id, $1, 'staff' FROM users WHERE email = $2`, [owner.shopId, helper.email]);
    const staffApi = client((await helper.api.post('/auth/switch-branch', { shopId: owner.shopId })).body.token);
    const x = await staffApi.post('/expenses', { spentOn: await istDay(), category: 'Transport', amount: '120' });
    assert.equal(x.status, 201);
    assert.equal((await staffApi.put(`/expenses/${x.body.id}`, { spentOn: await istDay(), category: 'X', amount: '1' })).status, 403);
    assert.equal((await staffApi.del(`/expenses/${x.body.id}`)).status, 403);
    assert.equal((await owner.api.get('/expenses')).body.rows[0].createdByName, 'Owner');
  });
});
