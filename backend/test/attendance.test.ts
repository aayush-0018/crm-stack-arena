import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { client, newShop, sql, start, stop } from './helpers';

before(start);
after(stop);

const istDay = async (n = 0) => (await sql(`SELECT ((now() AT TIME ZONE 'Asia/Kolkata')::date + $1::int)::text AS d`, [n]))[0].d as string;

describe('staff register', () => {
  test('owners add, edit, deactivate and remove staff; bad input is refused', async () => {
    const { api } = await newShop();
    const r = await api.post('/staff', { name: '  Ravi ', phone: '+91 98765 43210', jobTitle: 'Cook', dailyWage: '650', joinedOn: '2026-01-15' });
    assert.equal(r.status, 201);
    assert.equal(r.body.name, 'Ravi');
    assert.equal(r.body.phone, '9876543210');
    assert.equal(r.body.dailyWagePaise, 65000);
    assert.equal(r.body.joinedOn, '2026-01-15');
    assert.equal(r.body.active, true);

    const bad = await api.post('/staff', { name: '', phone: '12345' });
    assert.equal(bad.status, 400);
    assert.ok(bad.body.error.details.name);
    assert.ok(bad.body.error.details.phone);

    const e = await api.put(`/staff/${r.body.id}`, { name: 'Ravi K', dailyWage: '' });
    assert.equal(e.body.name, 'Ravi K');
    assert.equal(e.body.dailyWagePaise, null);
    assert.equal(e.body.phone, null);

    assert.equal((await api.patch(`/staff/${r.body.id}/active`, { active: false })).body.active, false);
    assert.equal((await api.del(`/staff/${r.body.id}`)).status, 204);
    assert.deepEqual((await api.get('/staff')).body, []);
  });

  test('staff logins can mark attendance but not change the register, and never see wages', async () => {
    const owner = await newShop();
    const emp = (await owner.api.post('/staff', { name: 'Asha', dailyWage: '500' })).body;
    const helper = await newShop();
    await sql(`INSERT INTO shop_members (user_id, shop_id, role) SELECT id, $1, 'staff' FROM users WHERE email = $2`, [owner.shopId, helper.email]);
    const staffApi = client((await helper.api.post('/auth/switch-branch', { shopId: owner.shopId })).body.token);

    assert.equal((await staffApi.post('/staff', { name: 'X' })).status, 403);
    assert.equal((await staffApi.put(`/staff/${emp.id}`, { name: 'X' })).status, 403);
    assert.equal((await staffApi.del(`/staff/${emp.id}`)).status, 403);
    assert.equal((await staffApi.get('/staff')).body[0].dailyWagePaise, null);

    const saved = await staffApi.put('/attendance/day', { date: await istDay(), marks: [{ employeeId: emp.id, status: 'present' }] });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.staff[0].mark.status, 'present');
    const month = (await staffApi.get('/attendance/month')).body;
    assert.equal(month.staff[0].payPaise, null);
  });

  test('another shop cannot see or touch the register', async () => {
    const a = await newShop();
    const emp = (await a.api.post('/staff', { name: 'Asha' })).body;
    const b = await newShop('Other');
    assert.deepEqual((await b.api.get('/staff')).body, []);
    assert.equal((await b.api.put(`/staff/${emp.id}`, { name: 'X' })).status, 404);
    assert.equal((await b.api.put('/attendance/day', { date: await istDay(), marks: [{ employeeId: emp.id, status: 'present' }] })).status, 404);
  });
});

describe('attendance', () => {
  test('marking a day: statuses, times, clearing, and no future days', async () => {
    const { api } = await newShop();
    const a = (await api.post('/staff', { name: 'Asha', dailyWage: '500' })).body;
    const b = (await api.post('/staff', { name: 'Bala' })).body;
    const c = (await api.post('/staff', { name: 'Chitra' })).body;
    const today = await istDay();

    const empty = (await api.get('/attendance/day')).body;
    assert.equal(empty.date, today);
    assert.equal(empty.counts.unmarked, 3);

    const r = await api.put('/attendance/day', {
      date: today,
      marks: [
        { employeeId: a.id, status: 'present', checkIn: '09:05', checkOut: '18:30' },
        { employeeId: b.id, status: 'absent', checkIn: '09:00', note: 'Sick' },
      ],
    });
    assert.equal(r.status, 200);
    const byName = Object.fromEntries(r.body.staff.map((s: any) => [s.name, s.mark]));
    assert.deepEqual(
      { status: byName.Asha.status, checkIn: byName.Asha.checkIn, checkOut: byName.Asha.checkOut },
      { status: 'present', checkIn: '09:05', checkOut: '18:30' },
    );
    assert.equal(byName.Bala.checkIn, null, 'absent has no hours');
    assert.equal(byName.Bala.note, 'Sick');
    assert.equal(byName.Chitra, null);
    assert.deepEqual(r.body.counts, { present: 1, half_day: 0, absent: 1, leave: 0, week_off: 0, unmarked: 1 });

    // Changing and clearing a mark.
    await api.put('/attendance/day', { date: today, marks: [{ employeeId: a.id, status: 'half_day' }, { employeeId: b.id, status: null }] });
    const after = (await api.get(`/attendance/day?date=${today}`)).body;
    assert.equal(after.staff.find((s: any) => s.id === a.id).mark.status, 'half_day');
    assert.equal(after.staff.find((s: any) => s.id === b.id).mark, null);

    assert.equal((await api.put('/attendance/day', { date: await istDay(1), marks: [{ employeeId: c.id, status: 'present' }] })).status, 400);
    assert.equal((await api.put('/attendance/day', { date: today, marks: [{ employeeId: c.id, status: 'present', checkIn: '18:00', checkOut: '09:00' }] })).status, 400);
    assert.equal((await api.put('/attendance/day', { date: today, marks: [{ employeeId: c.id, status: 'late' }] })).status, 400);
  });

  test('the month view totals each person; staff who left still show where they were marked', async () => {
    const { api } = await newShop();
    const a = (await api.post('/staff', { name: 'Asha', dailyWage: '500' })).body;
    const gone = (await api.post('/staff', { name: 'Zed' })).body;
    const never = (await api.post('/staff', { name: 'Yusuf' })).body;
    const today = await istDay();
    const month = today.slice(0, 7);
    const first = `${month}-01`;

    await api.put('/attendance/day', { date: first, marks: [{ employeeId: a.id, status: 'present' }, { employeeId: gone.id, status: 'present' }] });
    if (today !== first) await api.put('/attendance/day', { date: today, marks: [{ employeeId: a.id, status: 'half_day' }] });
    else await api.put('/attendance/day', { date: await istDay(-1), marks: [{ employeeId: a.id, status: 'half_day' }] }); // other month: not counted
    await api.patch(`/staff/${gone.id}/active`, { active: false });
    await api.patch(`/staff/${never.id}/active`, { active: false });

    const m = (await api.get(`/attendance/month?month=${month}`)).body;
    assert.equal(m.days[0], first);
    assert.equal(m.days.length >= 28 && m.days.length <= 31, true);
    assert.deepEqual(m.staff.map((s: any) => s.name), ['Asha', 'Zed'], 'inactive staff with no marks this month are left out');
    const asha = m.staff[0];
    assert.equal(asha.marks[first].status, 'present');
    if (today !== first) {
      assert.equal(asha.present, 1);
      assert.equal(asha.halfDay, 1);
      assert.equal(asha.workedDays, 1.5);
      assert.equal(asha.payPaise, 75000);
      assert.equal(asha.unmarked, m.days.filter((d: string) => d <= today).length - 2);
    } else {
      assert.equal(asha.workedDays, 1);
      assert.equal(asha.payPaise, 50000);
    }
    assert.equal((await api.get('/attendance/month?month=2026-13')).status, 400);
  });
});
