import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { client, sql, start, stop } from './helpers';

before(start);
after(stop);

describe('complaints form', () => {
  test('anyone can send one; it is saved with a reference; bad input is refused', async () => {
    const api = client();
    const r = await api.post('/public/complaints', { topic: 'privacy', name: 'Ravi', email: 'Ravi@Example.test', message: 'Please delete my phone number from your records.' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.match(r.body.reference, /^CMP-\d{6}$/);
    const [row] = await sql(`SELECT topic, email, status FROM complaints ORDER BY id DESC LIMIT 1`);
    assert.deepEqual([row.topic, row.email, row.status], ['privacy', 'ravi@example.test', 'open']);

    const bad = await api.post('/public/complaints', { name: '', email: 'nope', message: 'short' });
    assert.equal(bad.status, 400);
    assert.match(JSON.stringify(bad.body), /email/);
  });
});
