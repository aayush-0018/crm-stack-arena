import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { client, newShop, nextPhone, sql, start, stop } from './helpers';

before(start);
after(async () => {
  const { bookingMailsSettled } = await import('../src/modules/reservations/reservations.mail');
  await bookingMailsSettled();
  await stop();
});

// Emails go to the console mailer in tests; keep them here so codes and confirmations can be read.
const mails: string[] = [];
const log = console.log;
console.log = (...args: unknown[]) => {
  const s = args.map(String).join(' ');
  if (s.includes('--- email')) mails.push(s);
  else log(...args);
};
const mailsTo = (email: string) => mails.filter((m) => m.includes(`To: ${email}`));
const settled = async () => (await import('../src/modules/reservations/reservations.mail')).bookingMailsSettled();

const istDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
/** A day far enough ahead that "too soon" never gets in the way. */
const inDays = (n: number) => istDate(new Date(Date.now() + n * 86_400_000));
const DAY = inDays(3);
const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

const table = (label: string, seats: number, x: number) => ({ label, seats, shape: 'square', x, y: 40, w: 80, h: 80, rotation: 0 });

/** A café with a 2-seater, two 4-seaters and a 6-seater. */
async function cafe() {
  const s = await newShop('Bistro');
  const saved = await s.api.put('/floor-plan', {
    floors: [{ name: 'Ground floor', width: 1200, height: 800, decor: [], tables: [table('T1', 2, 20), table('T2', 4, 120), table('T3', 4, 220), table('T4', 6, 320)] }],
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const ids = Object.fromEntries(saved.body.floors[0].tables.map((t: { label: string; id: number }) => [t.label, t.id])) as Record<string, number>;
  return { ...s, ids };
}

const booking = (extra: Record<string, unknown> = {}) => ({
  name: 'Kavya Iyer',
  phone: nextPhone(),
  partySize: 2,
  date: DAY,
  time: '19:00',
  durationMinutes: 90,
  ...extra,
});

describe('staff bookings', () => {
  test('a booking gets the smallest free table that fits, and is saved as a customer', async () => {
    const { api, ids } = await cafe();
    const phone = nextPhone();
    const r = await api.post('/reservations', booking({ phone, partySize: 3, email: 'Kavya@Example.test', notes: 'Window seat please' }));
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.deepEqual(r.body.tableIds, [ids.T2]);
    assert.equal(r.body.tables[0].label, 'T2');
    assert.equal(r.body.status, 'booked');
    assert.equal(r.body.source, 'staff');
    assert.equal(r.body.email, 'kavya@example.test');
    assert.equal(new Date(r.body.startsAt).toISOString(), new Date(`${DAY}T19:00:00+05:30`).toISOString());
    assert.equal(new Date(r.body.endsAt).getTime() - new Date(r.body.startsAt).getTime(), 90 * 60_000);

    const [cust] = await sql(`SELECT name, phone FROM customers WHERE id = $1`, [r.body.customerId]);
    assert.equal(cust.phone, phone);

    await settled();
    const mail = mailsTo('kavya@example.test').pop() ?? '';
    assert.match(mail, /Your table at Bistro \d+ is booked/);
    assert.match(mail, /3 people on .* at 7:00 pm/);
    assert.match(mail, /\/b\/[A-Za-z0-9_-]{20,}/);

    const day = await api.get(`/reservations?date=${DAY}`);
    assert.equal(day.status, 200);
    assert.equal(day.body.length, 1);
  });

  test('an existing customer is linked by mobile number and keeps their details', async () => {
    const { api } = await cafe();
    const phone = nextPhone();
    const c = await api.post('/customers', { name: 'Original Name', phone });
    const r = await api.post('/reservations', booking({ phone, name: 'Other Name' }));
    assert.equal(r.body.customerId, c.body.id);
    assert.equal((await sql(`SELECT name FROM customers WHERE id = $1`, [c.body.id]))[0].name, 'Original Name');
  });

  test('a table cannot be double-booked, but back-to-back is fine', async () => {
    const { api, ids } = await cafe();
    assert.equal((await api.post('/reservations', booking({ tableIds: [ids.T4], name: 'Arjun' }))).status, 201);

    const clash = await api.post('/reservations', booking({ tableIds: [ids.T4], time: '20:00' }));
    assert.equal(clash.status, 409);
    assert.equal(clash.body.error.code, 'TABLE_BOOKED');
    assert.match(clash.body.error.message, /T4 is booked 7:00 pm – 8:30 pm \(Arjun\)/);

    assert.equal((await api.post('/reservations', booking({ tableIds: [ids.T4], time: '20:30' }))).status, 201);
    assert.equal((await api.post('/reservations', booking({ tableIds: [ids.T4], time: '17:30' }))).status, 201);
    // Two tables pushed together for a big group.
    const big = await api.post('/reservations', booking({ tableIds: [ids.T2, ids.T3], partySize: 8 }));
    assert.equal(big.status, 201);
    assert.deepEqual(big.body.tables.map((t: { label: string }) => t.label), ['T2', 'T3']);
  });

  test('with every fitting table taken, the booking is kept without a table', async () => {
    const { api } = await cafe();
    const r = await api.post('/reservations', booking({ partySize: 12 }));
    assert.equal(r.status, 201);
    assert.deepEqual(r.body.tableIds, []);
  });

  test('bad input and removed tables are refused', async () => {
    const { api } = await cafe();
    const bad = await api.post('/reservations', booking({ phone: '12345', partySize: 0, time: '25:00' }));
    assert.equal(bad.status, 400);
    assert.ok(bad.body.error.details.phone && bad.body.error.details.partySize && bad.body.error.details.time);
    const gone = await api.post('/reservations', booking({ tableIds: [999999] }));
    assert.equal(gone.status, 409);
    assert.equal(gone.body.error.code, 'TABLE_GONE');
  });

  test('editing moves the booking (the guest is told) and checks the new table', async () => {
    const { api, ids } = await cafe();
    await api.post('/reservations', booking({ tableIds: [ids.T3], time: '21:00' }));
    const r = await api.post('/reservations', booking({ email: 'mover@example.test', tableIds: [ids.T2] }));

    const same = await api.put(`/reservations/${r.body.id}`, booking({ phone: r.body.phone, email: 'mover@example.test', tableIds: [ids.T2], time: '19:30' }));
    assert.equal(same.status, 200, JSON.stringify(same.body));
    const clash = await api.put(`/reservations/${r.body.id}`, booking({ phone: r.body.phone, tableIds: [ids.T3], time: '20:00' }));
    assert.equal(clash.status, 409);

    await settled();
    assert.match(mailsTo('mover@example.test').pop() ?? '', /has changed[\s\S]*7:30 pm/);
  });

  test('seat, finish, no-show and cancel follow the allowed steps', async () => {
    const { api, ids } = await cafe();
    const r = await api.post('/reservations', booking({ tableIds: [ids.T1], email: 'gone@example.test', date: istDate(new Date()), time: '00:00', durationMinutes: 720 }));
    const id = r.body.id;
    const set = (status: string) => api.post(`/reservations/${id}/status`, { status });

    assert.equal((await set('finished')).status, 409);
    assert.equal((await set('seated')).body.status, 'seated');
    assert.equal((await set('booked')).body.status, 'booked'); // undo a mistaken seat
    assert.equal((await set('seated')).status, 200);
    const done = await set('finished');
    assert.equal(done.body.status, 'finished');
    // Leaving early frees the table straight away.
    assert.ok(new Date(done.body.endsAt).getTime() <= Date.now() + 1000);
    assert.equal((await set('seated')).status, 409);

    const c = await api.post('/reservations', booking({ email: 'cancel@example.test' }));
    assert.equal((await api.post(`/reservations/${c.body.id}/status`, { status: 'cancelled' })).body.status, 'cancelled');
    await settled();
    assert.match(mailsTo('cancel@example.test').pop() ?? '', /is cancelled/);
    // A cancelled booking frees its table.
    assert.equal((await api.post('/reservations', booking({ tableIds: c.body.tableIds }))).status, 201);

    const n = await api.post('/reservations', booking());
    assert.equal((await api.post(`/reservations/${n.body.id}/status`, { status: 'no_show' })).body.status, 'no_show');
    assert.equal((await api.put(`/reservations/${n.body.id}`, booking())).status, 409);
  });

  test('the live floor shows bookings coming up soon', async () => {
    const { api, ids } = await cafe();
    const soon = new Date(Date.now() + 45 * 60_000);
    const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(soon);
    await api.post('/reservations', booking({ tableIds: [ids.T3], date: istDate(soon), time }));
    await api.post('/reservations', booking({ tableIds: [ids.T4], date: inDays(5) }));
    const live = await api.get('/floor-plan/live');
    assert.equal(live.status, 200);
    assert.deepEqual(live.body.reservations.map((r: { tableIds: number[] }) => r.tableIds), [[ids.T3]]);
  });

  test('another branch cannot see or change bookings', async () => {
    const { api } = await cafe();
    const r = await api.post('/reservations', booking());
    const other = await newShop();
    assert.equal((await other.api.post(`/reservations/${r.body.id}/status`, { status: 'cancelled' })).status, 404);
    assert.equal((await other.api.get(`/reservations?date=${DAY}`)).body.length, 0);
  });
});

describe('booking settings', () => {
  test('owners save the rules and the link; staff only read them', async () => {
    const { api, shopId } = await cafe();
    const defaults = await api.get('/reservations/settings');
    assert.equal(defaults.body.bookingToken, null);
    assert.equal(defaults.body.durationMinutes, 90);

    const bad = await api.put('/reservations/settings', { ...defaults.body, opensAt: '22:00', closesAt: '10:00' });
    assert.equal(bad.status, 400);
    const saved = await api.put('/reservations/settings', { ...defaults.body, opensAt: '12:00', closedDays: [1, 1, 0], durationMinutes: 120 });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.deepEqual(saved.body.closedDays, [0, 1]);
    assert.equal(saved.body.opensAt, '12:00');

    const on = await api.post('/reservations/settings/link');
    assert.match(on.body.bookingToken, /^[A-Za-z0-9_-]{24}$/);

    const staff = await newShop();
    await sql(`INSERT INTO shop_members (user_id, shop_id, role) SELECT id, $1, 'staff' FROM users WHERE email = $2`, [shopId, staff.email]);
    const staffApi = client((await staff.api.post('/auth/switch-branch', { shopId })).body.token);
    assert.equal((await staffApi.get('/reservations/settings')).body.bookingToken, on.body.bookingToken);
    assert.equal((await staffApi.put('/reservations/settings', saved.body)).status, 403);
    assert.equal((await staffApi.del('/reservations/settings/link')).status, 403);
    // Staff do take bookings.
    assert.equal((await staffApi.post('/reservations', booking())).status, 201);

    const off = await api.del('/reservations/settings/link');
    assert.equal(off.body.bookingToken, null);
    assert.equal((await client().get(`/public/bookings/${on.body.bookingToken}`)).status, 404);
  });
});

describe('online booking', () => {
  async function bookingLink(rules: Record<string, unknown> = {}) {
    const c = await cafe();
    const s = (await c.api.get('/reservations/settings')).body;
    await c.api.put('/reservations/settings', { ...s, opensAt: '18:00', closesAt: '22:00', ...rules });
    const token = (await c.api.post('/reservations/settings/link')).body.bookingToken as string;
    return { ...c, token, pub: client() };
  }

  async function code(token: string, email = `guest-${randomUUID().slice(0, 8)}@example.test`, phone = nextPhone()) {
    const sent = await client().post(`/public/bookings/${token}/code`, { name: 'Neha Kapoor', phone, email });
    assert.equal(sent.status, 201, JSON.stringify(sent.body));
    const mail = mailsTo(email).pop() ?? '';
    assert.match(mail, /Your code to confirm your table booking/);
    return { email, phone, challenge: sent.body.challenge as string, code: /Subject: (\d{6}) is your code/.exec(mail)![1] };
  }

  test('the page shows the branch, and party size is capped by the largest table', async () => {
    const { token, pub } = await bookingLink({ maxParty: 10 });
    const page = await pub.get(`/public/bookings/${token}`);
    assert.equal(page.status, 200);
    assert.match(page.body.shop.name, /^Bistro/);
    assert.equal(page.body.maxParty, 6);
    assert.equal(page.body.durationMinutes, 90);
  });

  test('times follow opening hours, closed days and free tables', async () => {
    const { api, token, pub, ids } = await bookingLink();
    const times = await pub.get(`/public/bookings/${token}/times?date=${DAY}&party=5`);
    assert.equal(times.status, 200);
    // 18:00 to 20:30 (the last one that ends by 22:00), every 30 minutes.
    assert.deepEqual(times.body.times.map((t: { time: string }) => t.time), ['18:00', '18:30', '19:00', '19:30', '20:00', '20:30']);
    assert.ok(times.body.times.every((t: { available: boolean }) => t.available));

    // Only T4 seats five: once it's booked at 19:00 the overlapping times go.
    await api.post('/reservations', booking({ tableIds: [ids.T4], time: '19:00' }));
    const after = await pub.get(`/public/bookings/${token}/times?date=${DAY}&party=5`);
    assert.deepEqual(after.body.times.filter((t: { available: boolean }) => !t.available).map((t: { time: string }) => t.time), ['18:00', '18:30', '19:00', '19:30', '20:00']);
    // A couple still has tables.
    assert.ok((await pub.get(`/public/bookings/${token}/times?date=${DAY}&party=2`)).body.times.every((t: { available: boolean }) => t.available));

    assert.equal((await pub.get(`/public/bookings/${token}/times?date=${DAY}&party=7`)).body.reason, 'too_big');
    assert.equal((await pub.get(`/public/bookings/${token}/times?date=${inDays(-1)}&party=2`)).body.reason, 'out_of_range');
    assert.equal((await pub.get(`/public/bookings/${token}/times?date=${inDays(60)}&party=2`)).body.reason, 'out_of_range');

    const s = (await api.get('/reservations/settings')).body;
    await api.put('/reservations/settings', { ...s, closedDays: [weekdayOf(DAY)] });
    assert.equal((await pub.get(`/public/bookings/${token}/times?date=${DAY}&party=2`)).body.reason, 'closed');
  });

  test('email code -> booked on a free table, confirmation emailed, guest can cancel', async () => {
    const { api, token, pub, ids } = await bookingLink();
    const g = await code(token);

    const wrong = await pub.post(`/public/bookings/${token}/confirm`, { challenge: g.challenge, code: g.code === '000000' ? '111111' : '000000', date: DAY, time: '19:00', partySize: 4 });
    assert.equal(wrong.status, 400);
    assert.equal(wrong.body.error.code, 'WRONG_CODE');

    const ok = await pub.post(`/public/bookings/${token}/confirm`, { challenge: g.challenge, code: g.code, date: DAY, time: '19:00', partySize: 4, notes: 'Birthday' });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    const [r] = await sql(`SELECT * FROM reservations WHERE manage_token = $1`, [ok.body.manageToken]);
    assert.equal(r.source, 'online');
    assert.equal(r.email, g.email);
    assert.equal(r.phone, g.phone);
    assert.deepEqual(r.table_ids.map(Number), [ids.T2]);
    assert.ok(r.customer_id);

    await settled();
    const mail = mailsTo(g.email).pop() ?? '';
    assert.match(mail, /is booked/);
    assert.ok(mail.includes(`/b/${ok.body.manageToken}`));

    // The code was used.
    const again = await pub.post(`/public/bookings/${token}/confirm`, { challenge: g.challenge, code: g.code, date: DAY, time: '20:00', partySize: 2 });
    assert.equal(again.body.error.code, 'CODE_EXPIRED');

    const view = await pub.get(`/public/reservations/${ok.body.manageToken}`);
    assert.equal(view.status, 200);
    assert.equal(view.body.partySize, 4);
    assert.equal(view.body.canCancel, true);
    assert.equal(view.body.email, undefined);

    const day = (await api.get(`/reservations?date=${DAY}`)).body;
    assert.equal(day[0].notes, 'Birthday');

    const cancelled = await pub.post(`/public/reservations/${ok.body.manageToken}/cancel`);
    assert.equal(cancelled.body.status, 'cancelled');
    assert.equal(cancelled.body.canCancel, false);
    assert.equal((await pub.post(`/public/reservations/${ok.body.manageToken}/cancel`)).status, 409);
  });

  test('a time taken meanwhile is refused and the code still works for another time', async () => {
    const { api, token, pub, ids } = await bookingLink();
    const g = await code(token);
    await api.post('/reservations', booking({ tableIds: [ids.T4], time: '19:00' }));
    const taken = await pub.post(`/public/bookings/${token}/confirm`, { challenge: g.challenge, code: g.code, date: DAY, time: '19:00', partySize: 6 });
    assert.equal(taken.status, 409);
    assert.equal(taken.body.error.code, 'SLOT_TAKEN');
    const other = await pub.post(`/public/bookings/${token}/confirm`, { challenge: g.challenge, code: g.code, date: DAY, time: '20:30', partySize: 6 });
    assert.equal(other.status, 201, JSON.stringify(other.body));
    // Times off the half-hour grid or outside the hours are refused.
    const g2 = await code(token);
    assert.equal((await pub.post(`/public/bookings/${token}/confirm`, { challenge: g2.challenge, code: g2.code, date: DAY, time: '19:10', partySize: 2 })).status, 409);
  });

  test('one email cannot hold two bookings at the same time', async () => {
    const { token, pub } = await bookingLink();
    const email = `twice-${randomUUID().slice(0, 8)}@example.test`;
    const g = await code(token, email);
    assert.equal((await pub.post(`/public/bookings/${token}/confirm`, { challenge: g.challenge, code: g.code, date: DAY, time: '19:00', partySize: 2 })).status, 201);
    await sql(`UPDATE guest_otps SET created_at = created_at - interval '1 minute'`);
    const g2 = await code(token, email, g.phone);
    const dup = await pub.post(`/public/bookings/${token}/confirm`, { challenge: g2.challenge, code: g2.code, date: DAY, time: '19:30', partySize: 2 });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error.code, 'ALREADY_BOOKED');
  });

  test('unknown or switched-off links show nothing', async () => {
    assert.equal((await client().get(`/public/bookings/${'x'.repeat(24)}`)).status, 404);
    assert.equal((await client().get(`/public/reservations/${'x'.repeat(24)}`)).status, 404);
    assert.equal((await client().get('/public/bookings/short')).status, 400);
  });
});
