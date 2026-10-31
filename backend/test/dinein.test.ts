import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { client, Client, newShop, sql, start, stop } from './helpers';

before(start);
after(stop);

const floor = (name: string, tables: Record<string, unknown>[], decor: Record<string, unknown>[] = [], extra: Record<string, unknown> = {}) => ({
  name,
  width: 1200,
  height: 800,
  decor,
  tables,
  ...extra,
});
const table = (label: string, x = 40, extra: Record<string, unknown> = {}) => ({ label, seats: 4, shape: 'square', x, y: 40, w: 80, h: 80, rotation: 0, ...extra });

async function cafe() {
  const s = await newShop('Cafe');
  const coffee = (await s.api.post('/products', { name: 'Cappuccino', category: 'Coffee', unit: 'pcs', price: '150', trackStock: false })).body;
  const cake = (await s.api.post('/products', { name: 'Brownie', category: 'Desserts', unit: 'pcs', price: '120.50', openingStock: '3' })).body;
  const saved = await s.api.put('/floor-plan', {
    floors: [floor('Ground floor', [table('T1'), table('T2', 200)], [{ id: 'k', kind: 'kitchen', x: 600, y: 0, w: 300, h: 200, rotation: 0, label: 'Kitchen' }])],
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  return { ...s, coffee, cake, plan: saved.body, t1: saved.body.floors[0].tables[0], t2: saved.body.floors[0].tables[1] };
}

const order = (c: Client | ReturnType<typeof client>, token: string, items: { productId: number; quantity: number }[], extra: Record<string, unknown> = {}) =>
  c.post(`/public/tables/${token}/orders`, { items, idempotencyKey: randomUUID(), ...extra });

describe('floor plan with floors', () => {
  test('floors keep tables and QR codes; tables can move between floors; removed ones stop working; lock', async () => {
    const { api, plan, t1, t2 } = await cafe();
    const ground = plan.floors[0];

    // Add a first floor and move T2 there; rename T1.
    const saved = await api.put('/floor-plan', {
      floors: [
        { ...ground, tables: [{ ...t1, label: 'G1' }] },
        floor('First floor', [{ ...t2, x: 300 }, table('F2', 500)]),
      ],
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const [g, f] = saved.body.floors;
    assert.equal(g.id, ground.id);
    assert.equal(f.name, 'First floor');
    assert.deepEqual(g.tables.map((t: { id: number; label: string; qrToken: string }) => [t.id, t.label, t.qrToken]), [[t1.id, 'G1', t1.qrToken]]);
    assert.equal(f.tables.find((t: { id: number }) => t.id === t2.id).qrToken, t2.qrToken);
    const menu = (await client().get(`/public/tables/${t2.qrToken}`)).body;
    assert.equal(menu.table.label, 'T2');

    // Same table name on two floors, or two floors with one name: refused.
    assert.equal((await api.put('/floor-plan', { floors: [floor('A', [table('X')]), floor('B', [table('x')])] })).status, 400);
    assert.equal((await api.put('/floor-plan', { floors: [floor('Same', []), floor('same', [])] })).status, 400);
    assert.equal((await api.put('/floor-plan', { floors: [] })).status, 400);

    // Delete the first floor: its tables' QR codes stop working.
    await api.put('/floor-plan', { floors: [{ ...g }] });
    assert.equal((await client().get(`/public/tables/${t2.qrToken}`)).status, 404);
    assert.equal((await api.get('/floor-plan')).body.floors.length, 1);

    assert.equal((await api.put('/floor-plan/lock', { locked: true })).body.locked, true);
    assert.equal((await api.put('/floor-plan', { floors: [g] })).status, 409);
  });

  test("another shop can't see or change the plan", async () => {
    const { t1 } = await cafe();
    const other = await newShop();
    assert.deepEqual((await other.api.get('/floor-plan')).body.floors[0].tables, []);
    assert.equal((await other.api.post(`/floor-plan/tables/${t1.id}/new-qr`)).status, 404);
  });
});

describe('ordering from a table', () => {
  test('menu, order, kitchen, paid, served -> completed, with stock taken', async () => {
    const { api, coffee, cake, t1: pt1, t2: pt2 } = await cafe();
    const guest = client();
    const t1 = pt1;

    const menu = (await guest.get(`/public/tables/${t1.qrToken}`)).body;
    assert.equal(menu.table.label, 'T1');
    assert.deepEqual(menu.products.map((x: { name: string }) => x.name).sort(), ['Brownie', 'Cappuccino']);
    assert.equal(menu.products[0].costPaise, undefined);

    const placed = await order(guest, t1.qrToken, [
      { productId: coffee.id, quantity: 2 },
      { productId: cake.id, quantity: 1 },
    ], { name: 'Asha', note: 'Less sugar', unitPrice: '1' });
    assert.equal(placed.status, 201);
    const view = (await guest.get(`/public/table-orders/${placed.body.guestToken}`)).body;
    assert.equal(view.kitchenStatus, 'new');
    assert.equal(view.tableLabel, 'T1');
    assert.equal(view.totalPaise, 42050); // prices from the product list, not the request
    assert.equal(view.paymentStatus, 'unpaid');

    // It is an ordinary walk-in order with stock taken.
    const k = (await api.get('/kitchen')).body;
    assert.equal(k.length, 1);
    assert.equal(k[0].guestName, 'Asha');
    assert.equal(k[0].notes, 'Less sugar');
    assert.equal(k[0].items.length, 2);
    const full = (await api.get(`/orders/${k[0].id}`)).body;
    assert.equal(full.customerId, null);
    assert.equal((await api.get(`/products/${cake.id}`)).body.stockMilli, 2000);

    // Live floor shows the table busy.
    assert.equal((await api.get('/floor-plan/live')).body.orders.length, 1);

    await api.patch(`/kitchen/${k[0].id}`, { status: 'preparing' });
    await api.patch(`/kitchen/${k[0].id}`, { status: 'served' });
    assert.equal((await api.get(`/orders/${k[0].id}`)).body.status, 'open'); // served but unpaid
    assert.equal((await api.get('/floor-plan/live')).body.orders.length, 1);

    const paid = await api.post(`/kitchen/${k[0].id}/paid`, { method: 'cash' });
    assert.equal(paid.status, 200);
    assert.equal(paid.body.orders.length, 0); // table free again
    const done = (await api.get(`/orders/${k[0].id}`)).body;
    assert.equal(done.status, 'completed');
    assert.equal(done.paymentStatus, 'paid');
    assert.equal(done.payments[0].method, 'cash');
    assert.equal((await guest.get(`/public/table-orders/${placed.body.guestToken}`)).body.paymentStatus, 'paid');
  });

  test('"paid" test checkbox records the payment; retries do not double-order', async () => {
    const { api, coffee, t1: pt1 } = await cafe();
    const key = randomUUID();
    const body = { items: [{ productId: coffee.id, quantity: 1 }], paid: true, idempotencyKey: key };
    const a = await client().post(`/public/tables/${pt1.qrToken}/orders`, body);
    const b = await client().post(`/public/tables/${pt1.qrToken}/orders`, body);
    assert.equal(a.body.guestToken, b.body.guestToken);
    const k = (await api.get('/kitchen')).body;
    assert.equal(k.length, 1);
    assert.equal(k[0].paymentStatus, 'paid');
    await api.patch(`/kitchen/${k[0].id}`, { status: 'served' });
    assert.equal((await api.get(`/orders/${k[0].id}`)).body.status, 'completed');
  });

  test('refused: unknown table, archived product, not enough stock, other shop product, too many', async () => {
    const { api, coffee, cake, t1: pt1, t2: pt2 } = await cafe();
    const tok = pt2.qrToken;
    assert.equal((await order(client(), 'x'.repeat(24), [{ productId: coffee.id, quantity: 1 }])).status, 404);
    const stock = await order(client(), tok, [{ productId: cake.id, quantity: 5 }]);
    assert.equal(stock.status, 409);
    assert.match(stock.body.error.message, /Not enough stock/);
    await api.patch(`/products/${coffee.id}/active`, { active: false });
    assert.equal((await order(client(), tok, [{ productId: coffee.id, quantity: 1 }])).status, 409);
    const other = await newShop();
    const theirs = (await other.api.post('/products', { name: 'Tea', unit: 'pcs', price: '20', trackStock: false })).body;
    assert.equal((await order(client(), tok, [{ productId: theirs.id, quantity: 1 }])).status, 409);
    assert.equal((await order(client(), tok, [{ productId: cake.id, quantity: 51 }])).status, 400);
    assert.deepEqual((await api.get('/kitchen')).body, []);
  });

  test('cancelled orders leave the kitchen; staff of another shop cannot touch them', async () => {
    const { api, coffee, t1: pt1 } = await cafe();
    await order(client(), pt1.qrToken, [{ productId: coffee.id, quantity: 1 }]);
    const [k] = (await api.get('/kitchen')).body;
    const other = await newShop();
    assert.equal((await other.api.patch(`/kitchen/${k.id}`, { status: 'ready' })).status, 404);
    await api.patch(`/orders/${k.id}/status`, { status: 'cancelled' });
    assert.deepEqual((await api.get('/kitchen')).body, []);
    assert.equal((await api.patch(`/kitchen/${k.id}`, { status: 'ready' })).status, 409);
    const [row] = await sql(`SELECT source, table_label FROM orders WHERE id = $1`, [k.id]);
    assert.deepEqual(row, { source: 'table', table_label: 'T1' });
  });
});
