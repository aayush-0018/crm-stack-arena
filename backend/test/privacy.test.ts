import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { apiBase, client, newOrder, newShop, sql, start, stop } from './helpers';

before(start);
after(stop);

const deleteAccount = async (token: string, password: string) => {
  const r = await fetch(`${apiBase()}/auth/account`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ password }),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

describe('consent at sign-up', () => {
  test('sign-up needs the Terms and Privacy Policy accepted, and records when', async () => {
    const body = { shopName: 'Consent Shop', name: 'Owner', email: `consent-${Date.now()}@example.test`, password: 'password123' };
    const no = await client().post('/auth/register', body);
    assert.equal(no.status, 400);
    assert.match(JSON.stringify(no.body), /acceptTerms/);
    const yes = await client().post('/auth/register', { ...body, acceptTerms: true });
    assert.equal(yes.status, 201);
    const [u] = await sql(`SELECT terms_accepted_at FROM users WHERE id = $1`, [yes.body.user.id]);
    assert.ok(u.terms_accepted_at);
  });
});

describe('erasing a customer', () => {
  test('a deleted customer with orders loses their personal details; the order and its invoice copy stay', async () => {
    const { api } = await newShop();
    const o = await newOrder(api);
    const inv = (await api.post(`/orders/${o.id}/invoice`)).body;
    await api.put(`/customers/${o.customerId}`, { name: 'Priya', phone: (await api.get(`/customers/${o.customerId}`)).body.phone, email: 'p@example.test', address: '12 MG Road', notes: 'VIP' });
    assert.ok((await api.del(`/customers/${o.customerId}`)).status < 300);

    const [c] = await sql(`SELECT name, phone, email, address, notes, deleted_at FROM customers WHERE id = $1`, [o.customerId]);
    assert.deepEqual([c.name, c.phone, c.email, c.address, c.notes], ['Deleted customer', null, null, null, null]);
    assert.ok(c.deleted_at);
    assert.equal((await api.get(`/orders/${o.id}`)).status, 200, 'the order still opens');
    assert.equal((await api.get(`/invoices/${inv.id}`)).body.customerSnapshot.name, 'Cust', 'the issued invoice keeps its copy');
    await assert.rejects(sql(`UPDATE customers SET phone = NULL, deleted_at = NULL WHERE id = $1`, [o.customerId]), 'a live customer needs a phone');
  });
});

describe('deleting an account', () => {
  test('needs the password; removes branches only this user owns, with all their data; leaves others alone', async () => {
    const owner = await newShop();
    const { api } = owner;
    // A branch full of linked data: customers, orders, an invoice, payments, a return, products, stock, expenses.
    const p = (await api.post('/products', { name: 'Soap', price: '10', unit: 'pcs', trackStock: true, openingStock: '50' })).body;
    const o = await newOrder(api, { items: [{ itemName: 'Soap', quantity: '3', unitPrice: '10', productId: p.id } as any] });
    await api.post(`/orders/${o.id}/payments`, { amount: '30', method: 'cash' });
    await api.post(`/orders/${o.id}/invoice`);
    const ret = await api.post(`/orders/${o.id}/returns`, { items: [{ position: 1, quantity: '1', condition: 'saleable' }] });
    assert.equal(ret.status, 201, JSON.stringify(ret.body));
    await api.post('/expenses', { spentOn: (await sql(`SELECT ((now() AT TIME ZONE 'Asia/Kolkata')::date)::text AS d`))[0].d, category: 'Rent', amount: '100' });

    // A second branch co-owned with someone else survives.
    const partner = await newShop();
    await sql(`INSERT INTO shop_members (user_id, shop_id, role) SELECT id, $1, 'owner' FROM users WHERE email = $2`, [partner.shopId, owner.email]);
    const other = await newShop();
    await newOrder(other.api);

    assert.equal((await deleteAccount(owner.token, 'wrong-password')).status, 400);
    const r = await deleteAccount(owner.token, 'password123');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.deletedBranches, 1);

    for (const t of ['customers', 'orders', 'invoices', 'payments', 'order_returns', 'products', 'stock_movements', 'expenses']) {
      const [{ n }] = await sql(`SELECT count(*)::int AS n FROM ${t} WHERE shop_id = $1`, [owner.shopId]);
      assert.equal(n, 0, `${t} removed`);
    }
    assert.equal((await sql(`SELECT 1 FROM users WHERE lower(email) = lower($1)`, [owner.email])).length, 0);
    assert.equal((await sql(`SELECT 1 FROM shops WHERE id = $1`, [partner.shopId])).length, 1, 'the co-owned branch stays');
    assert.equal((await other.api.get('/orders')).body.data.length, 1, 'other shops untouched');
    assert.equal((await api.get('/auth/me')).status, 401, 'the old session no longer works');
  });
});
