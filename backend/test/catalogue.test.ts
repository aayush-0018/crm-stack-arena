import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { client, Client, newShop, sql, start, stop } from './helpers';

before(start);
after(stop);

const SETTINGS = { template: 'classic', title: null, tagline: null, showPrices: true, hideOutOfStock: true, showBranches: true };

const addProduct = async (api: Client, body: Record<string, unknown>) => {
  const r = await api.post('/products', { unit: 'pcs', price: '10', ...body });
  if (r.status !== 201) throw new Error(`product failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};

describe('catalogue', () => {
  test('one click creates a live link that shows active products by category, without cost or stock', async () => {
    const { api } = await newShop('Catalogue Shop');
    assert.equal((await api.get('/catalogue')).body, null);
    await addProduct(api, { name: 'Basmati rice', category: 'Grocery', unit: 'kg', price: '95', cost: '80', openingStock: '20' });
    await addProduct(api, { name: 'Notebook', price: '40', trackStock: false });
    await addProduct(api, { name: 'Atta', category: 'Grocery', price: '50', openingStock: '0' });
    const gone = await addProduct(api, { name: 'Old soap', category: 'Care', price: '20', trackStock: false });
    await api.patch(`/products/${gone.id}/active`, { active: false });

    const cat = (await api.post('/catalogue')).body;
    assert.match(cat.token, /^[A-Za-z0-9_-]{24}$/);
    // Clicking again keeps the same link.
    assert.equal((await api.post('/catalogue')).body.token, cat.token);

    const pub = await client().get(`/public/catalogues/${cat.token}`);
    assert.equal(pub.status, 200);
    assert.equal(pub.body.template, 'classic');
    assert.match(pub.body.shop.name, /^Catalogue Shop/);
    // Out-of-stock Atta is hidden by default; archived soap never shows; uncategorised last.
    assert.deepEqual(
      pub.body.products.map((p: { name: string }) => p.name),
      ['Basmati rice', 'Notebook'],
    );
    const rice = pub.body.products[0];
    assert.equal(rice.pricePaise, 9500);
    assert.equal(rice.unit, 'kg');
    assert.equal(rice.costPaise, undefined);
    assert.equal(rice.stockMilli, undefined);
    assert.equal(pub.body.shop.gstin, undefined);

    // A product added later appears without generating anything again.
    await addProduct(api, { name: 'Ghee', category: 'Grocery', price: '600', trackStock: false });
    const names = (await client().get(`/public/catalogues/${cat.token}`)).body.products.map((p: { name: string }) => p.name);
    assert.ok(names.includes('Ghee'));
  });

  test('settings: hide prices, show out-of-stock items, title and tagline', async () => {
    const { api } = await newShop();
    await addProduct(api, { name: 'Atta', price: '50', openingStock: '0' });
    const { token } = (await api.post('/catalogue')).body;
    const put = await api.put('/catalogue', { ...SETTINGS, title: 'Diwali 2026', tagline: '  Fresh every day ', showPrices: false, hideOutOfStock: false });
    assert.equal(put.status, 200);
    assert.equal(put.body.tagline, 'Fresh every day');
    const pub = (await client().get(`/public/catalogues/${token}`)).body;
    assert.equal(pub.title, 'Diwali 2026');
    assert.equal(pub.showPrices, false);
    assert.equal(pub.products.length, 1);
    assert.equal(pub.products[0].pricePaise, null);
    assert.equal(pub.products[0].available, false);

    assert.equal((await api.put('/catalogue', { ...SETTINGS, template: 'neon' })).status, 400);
    assert.equal((await api.put('/catalogue', { ...SETTINGS, title: 'x'.repeat(81) })).status, 400);
  });

  test('other branches of the same owner are listed with their addresses', async () => {
    const { api } = await newShop('Main');
    await api.put('/shop', { ...(await api.get('/shop')).body, addressLine1: '12 MI Road', city: 'Jaipur', pincode: '302001' });
    const second = (await api.post('/branches', { name: 'Vaishali Nagar', city: 'Jaipur', phone: '0141 2345678', code: null })).body;
    // A branch with nothing to show a customer is left out.
    await api.post('/branches', { name: 'Godown', city: null, phone: null, code: null });
    const { token } = (await api.post('/catalogue')).body;

    let pub = (await client().get(`/public/catalogues/${token}`)).body;
    assert.equal(pub.shop.addressLine1, '12 MI Road');
    assert.deepEqual(
      pub.branches.map((b: { name: string }) => b.name),
      ['Vaishali Nagar'],
    );
    assert.equal(pub.branches[0].phone, '0141 2345678');

    // Another owner's shop never appears.
    await newShop('Stranger');
    pub = (await client().get(`/public/catalogues/${token}`)).body;
    assert.equal(pub.branches.length, 1);

    await api.put('/catalogue', { ...SETTINGS, showBranches: false });
    assert.deepEqual((await client().get(`/public/catalogues/${token}`)).body.branches, []);

    // Each branch has its own catalogue and products.
    const switched = await api.post('/auth/switch-branch', { shopId: second.id });
    const branchApi = client(switched.body.token);
    assert.equal((await branchApi.get('/catalogue')).body, null);
  });

  test('reset and turn off stop old links; staff cannot publish', async () => {
    const { api, shopId } = await newShop();
    const first = (await api.post('/catalogue')).body.token;
    const reset = (await api.post('/catalogue/reset-link')).body.token;
    assert.notEqual(reset, first);
    assert.equal((await client().get(`/public/catalogues/${first}`)).status, 404);
    assert.equal((await client().get(`/public/catalogues/${reset}`)).status, 200);

    const off = await api.del('/catalogue/link');
    assert.equal(off.body.token, null);
    assert.equal((await client().get(`/public/catalogues/${reset}`)).status, 404);
    assert.equal((await api.post('/catalogue/reset-link')).status, 409);
    // Turning it on again gives a new link; settings are kept.
    const again = (await api.post('/catalogue')).body.token;
    assert.ok(again && again !== reset);

    const staff = await newShop();
    await sql(`INSERT INTO shop_members (user_id, shop_id, role) SELECT id, $1, 'staff' FROM users WHERE email = $2`, [shopId, staff.email]);
    const staffApi = client((await staff.api.post('/auth/switch-branch', { shopId })).body.token);
    assert.equal((await staffApi.get('/catalogue')).body.token, again);
    assert.equal((await staffApi.post('/catalogue/reset-link')).status, 403);
    assert.equal((await staffApi.del('/catalogue/link')).status, 403);

    assert.equal((await client().get(`/public/catalogues/${'x'.repeat(24)}`)).status, 404);
    assert.equal((await client().get('/public/catalogues/short')).status, 400);
  });
});
