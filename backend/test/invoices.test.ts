import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { client, newOrder, newShop, start, stop } from './helpers';

before(start);
after(stop);

describe('invoice lifecycle', () => {
  test('generating twice returns the same invoice, not a duplicate', async () => {
    const { api } = await newShop();
    const o = await newOrder(api);
    const a = await api.post(`/orders/${o.id}/invoice`);
    const b = await api.post(`/orders/${o.id}/invoice`);
    assert.equal(a.status, 201);
    assert.equal(b.status, 200);
    assert.equal(a.body.id, b.body.id);
    assert.match(a.body.invoiceNumber, /^INV-\d{4}-000001$/);
  });

  test('editing items outdates the invoice; reissue supersedes it and keeps the number', async () => {
    const { api } = await newShop();
    const o = await newOrder(api);
    const first = (await api.post(`/orders/${o.id}/invoice`)).body;
    await api.put(`/orders/${o.id}`, { items: [{ itemName: 'Rice', quantity: '3', unitPrice: '50' }], discount: '0' });
    const order = (await api.get(`/orders/${o.id}`)).body;
    assert.equal(order.invoice.outdated, true);

    assert.equal((await api.post(`/orders/${o.id}/invoice`)).status, 409); // needs explicit reissue
    const second = (await api.post(`/orders/${o.id}/invoice?reissue=true`)).body;
    assert.equal(second.invoiceNumber, first.invoiceNumber);
    assert.equal(second.revision, 2);
    assert.equal(second.totalPaise, 15000);
    assert.equal((await api.get(`/invoices/${first.id}`)).body.status, 'superseded');
    // the old snapshot is unchanged
    assert.equal((await api.get(`/invoices/${first.id}`)).body.totalPaise, 10000);
  });

  test('cancelling the order voids its invoice; cancelled orders cannot be invoiced', async () => {
    const { api } = await newShop();
    const o = await newOrder(api);
    const inv = (await api.post(`/orders/${o.id}/invoice`)).body;
    await api.patch(`/orders/${o.id}/status`, { status: 'cancelled' });
    assert.equal((await api.get(`/invoices/${inv.id}`)).body.status, 'void');
    assert.equal((await api.post(`/orders/${o.id}/invoice`)).status, 409);
  });

  test('PDF renders, and the public share link serves only that invoice', async () => {
    const { api } = await newShop();
    const o = await newOrder(api);
    const inv = (await api.post(`/orders/${o.id}/invoice`)).body;
    const pdf = await api.get(`/invoices/${inv.id}/pdf`);
    assert.equal(pdf.status, 200);
    assert.match(String(pdf.body).slice(0, 5), /%PDF-/);
    const { token } = (await api.post(`/invoices/${inv.id}/share-link`)).body;
    assert.equal((await client().get(`/public/invoices/${token}/pdf`)).status, 200);
    assert.equal((await client().get(`/public/invoices/${'x'.repeat(24)}/pdf`)).status, 404);
  });

  test('resetting a share link stops the old link and the new one works', async () => {
    const { api } = await newShop();
    const o = await newOrder(api);
    const inv = (await api.post(`/orders/${o.id}/invoice`)).body;
    const old = (await api.post(`/invoices/${inv.id}/share-link`)).body.token;
    const fresh = (await api.post(`/invoices/${inv.id}/share-link/reset`)).body.token;
    assert.notEqual(fresh, old);
    assert.equal((await client().get(`/public/invoices/${old}/pdf`)).status, 404);
    assert.equal((await client().get(`/public/invoices/${fresh}/pdf`)).status, 200);
    // Opening the share screen again keeps the new link.
    assert.equal((await api.post(`/invoices/${inv.id}/share-link`)).body.token, fresh);
    // Another shop can't reset it.
    const other = await newShop('Other Shop');
    assert.equal((await other.api.post(`/invoices/${inv.id}/share-link/reset`)).status, 404);
  });

  test('invoice summary counts each order once', async () => {
    const { api } = await newShop();
    const o1 = await newOrder(api, { amountPaid: '30' });
    const o2 = await newOrder(api);
    await api.post(`/orders/${o1.id}/invoice`);
    await api.post(`/orders/${o2.id}/invoice`);
    const s = (await api.get('/invoices/summary')).body;
    assert.equal(s.issued30, 2);
    assert.equal(s.invoiced30Paise, 20000);
    assert.equal(s.duePaise, 17000);
  });
});
