import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { gstBreakup, netOfDiscount, splitInclusive } from '../src/lib/gst';
import { newOrder, newShop, sql, start, stop } from './helpers';

before(start);
after(stop);

const product = async (api: any, name: string, price: string, gstRate: number | null) => {
  const r = await api.post('/products', { name, price, unit: 'pcs', trackStock: false, gstRate });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
};
const line = (itemName: string, quantity: string, unitPrice: string, productId?: number) => ({ itemName, quantity, unitPrice, productId });

describe('GST maths', () => {
  test('the GST inside an inclusive price, split evenly into CGST and SGST', () => {
    assert.deepEqual(splitInclusive(11800, 18), { grossPaise: 11800, taxablePaise: 10000, cgstPaise: 900, sgstPaise: 900, taxPaise: 1800 });
    assert.deepEqual(splitInclusive(10500, 5), { grossPaise: 10500, taxablePaise: 10000, cgstPaise: 250, sgstPaise: 250, taxPaise: 500 });
    const odd = splitInclusive(100, 18); // 84.75 -> 85 taxable, 15 tax: 8 + 7
    assert.deepEqual([odd.taxablePaise, odd.cgstPaise, odd.sgstPaise], [85, 8, 7]);
    assert.equal(splitInclusive(5000, 0).taxPaise, 0);
    assert.equal(splitInclusive(10025, 0.25).taxablePaise, 10000);
  });

  test('an order discount is shared across lines and adds up exactly', () => {
    const nets = netOfDiscount([100, 100, 100], 100);
    assert.deepEqual(nets, [66, 67, 67]);
    const b = gstBreakup(
      [
        { gstRate: 18, lineTotalPaise: 23600 },
        { gstRate: null, lineTotalPaise: 10000 },
      ],
      3360,
    );
    assert.equal(b.rows[0].grossPaise + b.unratedPaise, 23600 + 10000 - 3360);
    assert.equal(b.rows[0].grossPaise, 21240); // 10% off each line
  });
});

describe('GST rates on products, orders and invoices', () => {
  test('a sale copies the product rate; changing the rate later leaves the sale and its invoice alone', async () => {
    const { api } = await newShop();
    const soap = await product(api, 'Soap', '118', 18);
    assert.equal(soap.gstRate, 18);
    const o = await newOrder(api, { items: [line('Soap', '2', '118', soap.id), line('Loose item', '1', '50')] } as any);
    const inv = (await api.post(`/orders/${o.id}/invoice`)).body;
    assert.deepEqual(
      inv.itemsSnapshot.map((i: any) => i.gstRate),
      [18, null],
    );
    assert.equal((await api.get(`/invoices/${inv.id}/pdf`)).status, 200);

    const put = await api.put(`/products/${soap.id}`, { name: 'Soap', price: '118', unit: 'pcs', trackStock: false, gstRate: '5%' });
    assert.equal(put.body.gstRate, 5);
    const [row] = await sql(`SELECT gst_rate::float8 AS r FROM order_items WHERE order_id = $1 AND position = 1`, [o.id]);
    assert.equal(row.r, 18);

    const bad = await api.put(`/products/${soap.id}`, { name: 'Soap', price: '118', unit: 'pcs', trackStock: false, gstRate: 7 });
    assert.equal(bad.status, 400);
    assert.ok(JSON.stringify(bad.body).includes('gstRate'), 'the error names the field');
  });

  test('a CSV without a GST column keeps each rate; one with it sets or clears the rate', async () => {
    const { api } = await newShop();
    const tea = await product(api, 'Tea', '105', 5);
    await api.post('/products/import', { dryRun: false, rows: [{ id: String(tea.id), name: 'Tea', price: '110' }] });
    assert.equal((await api.get(`/products/${tea.id}`)).body.gstRate, 5);
    await api.post('/products/import', { dryRun: false, rows: [{ id: String(tea.id), name: 'Tea', price: '110', gstRate: '12%' }] });
    assert.equal((await api.get(`/products/${tea.id}`)).body.gstRate, 12);
    await api.post('/products/import', { dryRun: false, rows: [{ id: String(tea.id), name: 'Tea', price: '110', gstRate: '' }] });
    assert.equal((await api.get(`/products/${tea.id}`)).body.gstRate, null);
  });
});

describe('GST summary report', () => {
  test('sales by rate, minus returns, without cancelled orders; unrated sales shown apart', async () => {
    const { api } = await newShop();
    const soap = await product(api, 'Soap', '118', 18);
    const tea = await product(api, 'Tea', '105', 5);
    const day = '2026-10-10';
    const a = await newOrder(api, { orderDate: day, items: [line('Soap', '2', '118', soap.id), line('Tea', '1', '105', tea.id), line('Loose', '1', '50')] } as any);
    const cancelled = await newOrder(api, { orderDate: day, items: [line('Soap', '5', '118', soap.id)] } as any);
    await api.patch(`/orders/${cancelled.id}/status`, { status: 'cancelled' });
    const ret = await api.post(`/orders/${a.id}/returns`, { items: [{ position: 1, quantity: '1', condition: 'saleable' }], returnDate: '2026-10-12' });
    assert.equal(ret.status, 201, JSON.stringify(ret.body));

    const r = (await api.get('/reports/gst?from=2026-10-01&to=2026-10-31')).body;
    assert.deepEqual(
      r.byRate.map((x: any) => [x.rate, x.salesPaise, x.returnsPaise, x.taxablePaise, x.cgstPaise, x.sgstPaise]),
      [
        [5, 10500, 0, 10000, 250, 250],
        [18, 23600, 11800, 10000, 900, 900],
      ],
    );
    assert.equal(r.totals.taxPaise, 2300);
    assert.deepEqual(r.unrated, { salesPaise: 5000, returnsPaise: 0 });
    assert.deepEqual(r.byMonth.map((x: any) => x.month), ['2026-10', '2026-10']);

    const none = (await api.get('/reports/gst?from=2026-09-01&to=2026-09-30')).body;
    assert.equal(none.byRate.length, 0);
    assert.equal((await api.get('/reports/gst?from=2026-10-31&to=2026-10-01')).status, 400);
  });

  test('lines sold before the product had a rate use its current rate', async () => {
    const { api } = await newShop();
    const rice = await product(api, 'Rice', '105', null);
    await newOrder(api, { orderDate: '2026-10-05', items: [line('Rice', '1', '105', rice.id)] } as any);
    let r = (await api.get('/reports/gst?from=2026-10-01&to=2026-10-31')).body;
    assert.equal(r.unrated.salesPaise, 10500);
    await api.put(`/products/${rice.id}`, { name: 'Rice', price: '105', unit: 'pcs', trackStock: false, gstRate: 5 });
    r = (await api.get('/reports/gst?from=2026-10-01&to=2026-10-31')).body;
    assert.deepEqual([r.byRate[0].rate, r.byRate[0].taxablePaise, r.unrated.salesPaise], [5, 10000, 0]);
  });
});
