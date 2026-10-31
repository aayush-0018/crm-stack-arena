import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { apiBase, client, newShop, nextPhone, sql, start, stop } from './helpers';

before(start);
after(async () => {
  const { billsSettled } = await import('../src/modules/dinein/bills');
  await billsSettled();
  await stop();
});

// Emails go to the console mailer in tests; keep them here so codes and bills can be read.
const mails: string[] = [];
const log = console.log;
console.log = (...args: unknown[]) => {
  const s = args.map(String).join(' ');
  if (s.includes('--- email')) mails.push(s);
  else log(...args);
};
const lastMailTo = (email: string) => [...mails].reverse().find((m) => m.includes(`To: ${email}`)) ?? '';

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

/** Name, mobile and email -> code by email -> session. */
async function verifiedGuest(tableToken: string, who: { name?: string; phone?: string; email?: string } = {}) {
  const g = { name: who.name ?? 'Asha Rao', phone: who.phone ?? nextPhone(), email: who.email ?? `guest-${randomUUID().slice(0, 8)}@example.test` };
  const sent = await client().post(`/public/tables/${tableToken}/code`, g);
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  const code = /Subject: (\d{6}) is your code/.exec(lastMailTo(g.email))?.[1];
  assert.ok(code, 'code email sent');
  const v = await client().post(`/public/tables/${tableToken}/verify`, { challenge: sent.body.challenge, code });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  const h = { 'X-Guest-Session': v.body.sessionToken };
  const c = client();
  return {
    ...g,
    verify: v.body,
    headers: h,
    order: (items: { productId: number; quantity: number }[], extra: Record<string, unknown> = {}) =>
      c.post(`/public/tables/${tableToken}/orders`, { items, idempotencyKey: randomUUID(), ...extra }, h),
  };
}

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
    assert.deepEqual(menu.table, { label: 'T2', floorName: 'First floor' });

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

describe('guest email code', () => {
  test('menu stays closed until the email code is confirmed; name, mobile and email are required', async () => {
    const { t1 } = await cafe();
    const closed = (await client().get(`/public/tables/${t1.qrToken}`)).body;
    assert.equal(closed.guest, null);
    assert.deepEqual(closed.products, []);
    assert.equal(closed.firstOrderDiscountPct, 15);

    for (const bad of [{ phone: '9876543210', email: 'a@b.co' }, { name: 'A', email: 'a@b.co' }, { name: 'A', phone: '9876543210' }, { name: 'A', phone: '123', email: 'a@b.co' }]) {
      assert.equal((await client().post(`/public/tables/${t1.qrToken}/code`, bad)).status, 400, JSON.stringify(bad));
    }
    // Ordering without a session is refused.
    const no = await client().post(`/public/tables/${t1.qrToken}/orders`, { items: [{ productId: 1, quantity: 1 }], idempotencyKey: randomUUID() });
    assert.equal(no.status, 401);
  });

  test('wrong codes count down, then the code is dead; resend is rate-limited', async () => {
    const { t1 } = await cafe();
    const email = `x-${randomUUID().slice(0, 6)}@example.test`;
    const sent = (await client().post(`/public/tables/${t1.qrToken}/code`, { name: 'Ravi', phone: nextPhone(), email })).body;
    assert.match(sent.sentTo, /^x•+@example\.test$/);
    assert.equal((await client().post(`/public/tables/${t1.qrToken}/code`, { name: 'Ravi', phone: nextPhone(), email })).status, 429);
    const code = /Subject: (\d{6})/.exec(lastMailTo(email))![1];
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      const r = await client().post(`/public/tables/${t1.qrToken}/verify`, { challenge: sent.challenge, code: wrong });
      assert.equal(r.status, 400);
    }
    const late = await client().post(`/public/tables/${t1.qrToken}/verify`, { challenge: sent.challenge, code });
    assert.equal(late.body.error.code, 'CODE_EXPIRED');
  });

  test('verifying links to the existing customer with that mobile, without changing their details', async () => {
    const { api, t1 } = await cafe();
    const phone = nextPhone();
    const existing = (await api.post('/customers', { name: 'Kiran Old', phone })).body;
    const g = await verifiedGuest(t1.qrToken, { name: 'Someone Else', phone });
    assert.equal(g.verify.discountPct, 15); // no orders yet
    const c = (await api.get(`/customers/${existing.id}`)).body;
    assert.equal(c.name, 'Kiran Old');
    assert.equal(c.email, null);
    const [row] = await sql(`SELECT customer_id FROM guest_sessions ORDER BY id DESC LIMIT 1`);
    assert.equal(Number(row.customer_id), existing.id);
  });
});

describe('ordering from a table', () => {
  test('first order gets 15% off once; later orders show as read-only history; kitchen, paid, served -> bill emailed', async () => {
    const { api, coffee, cake, t1 } = await cafe();
    const g = await verifiedGuest(t1.qrToken, { name: 'Asha Rao' });
    assert.equal(g.verify.discountPct, 15);

    const first = await g.order([
      { productId: coffee.id, quantity: 2 },
      { productId: cake.id, quantity: 1 },
    ], { note: 'Less sugar', unitPrice: '1' });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    // 300 + 120.50 = 420.50; 15% = 63.075 -> 63.08
    assert.equal(first.body.discountPaise, 6308);
    const view = (await client().get(`/public/table-orders/${first.body.guestToken}`)).body;
    assert.equal(view.subtotalPaise, 42050);
    assert.equal(view.discountPaise, 6308);
    assert.equal(view.totalPaise, 35742);
    assert.equal(view.billToken, null);

    // A second order in the same visit: no discount. Both listed for the guest, newest first.
    const second = await g.order([{ productId: coffee.id, quantity: 1 }], { paid: true });
    assert.equal(second.body.discountPaise, 0);
    const mine = await client().get(`/public/tables/${t1.qrToken}/my-orders`);
    assert.equal(mine.status, 401); // needs the session
    const res = await fetch(`${apiBase()}/public/tables/${t1.qrToken}/my-orders`, { headers: g.headers });
    const list = await res.json();
    assert.deepEqual(list.map((o: { totalPaise: number }) => o.totalPaise), [15000, 35742]);

    // It's the customer's order (not walk-in), with stock taken.
    const k = (await api.get('/kitchen')).body;
    assert.equal(k.length, 2);
    const firstK = k[0];
    assert.equal(firstK.guestName, 'Asha Rao');
    assert.equal(firstK.floorName, 'Ground floor');
    const full = (await api.get(`/orders/${firstK.id}`)).body;
    assert.ok(full.customerId);
    assert.equal(full.discountPaise, 6308);
    assert.equal((await api.get(`/products/${cake.id}`)).body.stockMilli, 2000);

    // Serve, then pay -> completed and the bill goes to the verified email.
    await api.patch(`/kitchen/${firstK.id}`, { status: 'served' });
    assert.equal(lastMailTo(g.email).includes('Your bill'), false);
    await api.post(`/kitchen/${firstK.id}/paid`, { method: 'cash' });
    const { billsSettled } = await import('../src/modules/dinein/bills');
    await billsSettled();
    const bill = lastMailTo(g.email);
    assert.match(bill, /Your bill from Cafe \d+ — INV-/);
    assert.match(bill, /Discount: −Rs\. 63\.08/);
    assert.match(bill, /\/bill\/[A-Za-z0-9_-]{24}/);
    assert.equal((await api.get(`/orders/${firstK.id}`)).body.status, 'completed');
    const after = (await client().get(`/public/table-orders/${first.body.guestToken}`)).body;
    assert.ok(after.billToken);
    assert.equal((await client().get(`/public/invoices/${after.billToken}/pdf`)).status, 200);

    // A new visit by the same person (later, so the resend limit doesn't apply): not first time any more.
    await sql(`UPDATE guest_otps SET created_at = created_at - interval '1 hour' WHERE email = $1`, [g.email]);
    const again = await verifiedGuest(t1.qrToken, { phone: g.phone, email: g.email });
    assert.equal(again.verify.discountPct, 0);
  });

  test('paid at the table + served -> completed with bill; retries do not double-order or double-discount', async () => {
    const { api, coffee, t1 } = await cafe();
    const g = await verifiedGuest(t1.qrToken);
    const key = randomUUID();
    const a = await g.order([{ productId: coffee.id, quantity: 1 }], { paid: true, idempotencyKey: key });
    const b = await g.order([{ productId: coffee.id, quantity: 1 }], { paid: true, idempotencyKey: key });
    assert.equal(a.body.guestToken, b.body.guestToken);
    assert.equal(b.body.discountPaise, 2250);
    const k = (await api.get('/kitchen')).body;
    assert.equal(k.length, 1);
    assert.equal(k[0].paymentStatus, 'paid');
    await api.patch(`/kitchen/${k[0].id}`, { status: 'served' });
    const { billsSettled } = await import('../src/modules/dinein/bills');
    await billsSettled();
    assert.equal((await api.get(`/orders/${k[0].id}`)).body.status, 'completed');
    assert.match(lastMailTo(g.email), /Your bill/);
  });

  test('refused: archived product, not enough stock, other shop product, too many', async () => {
    const { api, coffee, cake, t2 } = await cafe();
    const g = await verifiedGuest(t2.qrToken);
    const stock = await g.order([{ productId: cake.id, quantity: 5 }]);
    assert.equal(stock.status, 409);
    assert.match(stock.body.error.message, /Not enough stock/);
    await api.patch(`/products/${coffee.id}/active`, { active: false });
    assert.equal((await g.order([{ productId: coffee.id, quantity: 1 }])).status, 409);
    const other = await newShop();
    const theirs = (await other.api.post('/products', { name: 'Tea', unit: 'pcs', price: '20', trackStock: false })).body;
    assert.equal((await g.order([{ productId: theirs.id, quantity: 1 }])).status, 409);
    assert.equal((await g.order([{ productId: cake.id, quantity: 51 }])).status, 400);
    assert.deepEqual((await api.get('/kitchen')).body, []);
    // The failed attempts didn't use up the first-order discount.
    const ok = await g.order([{ productId: cake.id, quantity: 1 }]);
    assert.equal(ok.body.discountPaise, 1808);
  });

  test("a session from one shop doesn't work at another shop's table", async () => {
    const a = await cafe();
    const b = await cafe();
    const g = await verifiedGuest(a.t1.qrToken);
    const r = await client().post(`/public/tables/${b.t1.qrToken}/orders`, { items: [{ productId: b.coffee.id, quantity: 1 }], idempotencyKey: randomUUID() }, g.headers);
    assert.equal(r.status, 401);
  });

  test('cancelled orders leave the kitchen; staff of another shop cannot touch them', async () => {
    const { api, coffee, t1 } = await cafe();
    const g = await verifiedGuest(t1.qrToken);
    await g.order([{ productId: coffee.id, quantity: 1 }]);
    const [k] = (await api.get('/kitchen')).body;
    const other = await newShop();
    assert.equal((await other.api.patch(`/kitchen/${k.id}`, { status: 'ready' })).status, 404);
    await api.patch(`/orders/${k.id}/status`, { status: 'cancelled' });
    assert.deepEqual((await api.get('/kitchen')).body, []);
    assert.equal((await api.patch(`/kitchen/${k.id}`, { status: 'ready' })).status, 409);
  });
});
