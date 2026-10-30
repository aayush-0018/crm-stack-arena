import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { client, newShop, start, stop } from './helpers';

before(start);
after(stop);

const login = (email: string, password: string) => client().post('/auth/login', { email, password });

describe('login', () => {
  test('right password works, wrong password is 401 with a generic message', async () => {
    const { email } = await newShop();
    assert.equal((await login(email, 'password123')).status, 200);
    const bad = await login(email, 'nope-nope');
    assert.equal(bad.status, 401);
    assert.equal(bad.body.error.message, 'Invalid email or password');
    assert.equal((await login('nobody@example.test', 'whatever1')).status, 401);
  });

  test('an account locks for a while after 5 failed attempts, without affecting others', async () => {
    const victim = await newShop();
    const other = await newShop();
    for (let i = 0; i < 5; i++) assert.equal((await login(victim.email, `wrong-${i}`)).status, 401);
    const locked = await login(victim.email, 'password123'); // even the right password waits
    assert.equal(locked.status, 429);
    assert.match(locked.body.error.message, /Too many failed attempts/);
    assert.equal((await login(other.email, 'password123')).status, 200);
  });

  test('a successful login clears earlier failures', async () => {
    const { email } = await newShop();
    for (let i = 0; i < 4; i++) await login(email, `wrong-${i}`);
    assert.equal((await login(email, 'password123')).status, 200);
    for (let i = 0; i < 4; i++) assert.equal((await login(email, `wrong-${i}`)).status, 401);
  });

  test('one address guessing across many accounts is throttled', async () => {
    // 20 failures from this IP were not all on one account; the next attempt is refused.
    const shops = await Promise.all(Array.from({ length: 5 }, () => newShop()));
    let fails = 0;
    for (const s of shops) for (let i = 0; i < 4; i++, fails++) await login(s.email, `x-${i}`);
    // earlier tests in this file already failed 1 + 5 + 8 times from this IP
    const r = await login(shops[0].email, 'password123');
    assert.equal(r.status, 429);
    assert.ok(fails >= 20);
  });
});
