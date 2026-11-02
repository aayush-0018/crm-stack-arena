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

const mails: string[] = [];
const log = console.log;
console.log = (...args: unknown[]) => {
  const s = args.map(String).join(' ');
  if (s.includes('--- email')) mails.push(s);
  else log(...args);
};
const lastMailTo = (email: string) => [...mails].reverse().find((m) => m.includes(`To: ${email}`)) ?? '';

const PLACE_ID = 'ChIJN1t_tDeuEmsRUsoyG83frY4';
const table = (label: string, x: number) => ({ label, seats: 4, shape: 'square', x, y: 40, w: 80, h: 80, rotation: 0 });

/** A café with three tables, a ₹200 coffee and (unless `review` is false) a Google review link. */
async function cafe(review = true) {
  const s = await newShop('Game cafe');
  const coffee = (await s.api.post('/products', { name: 'Coffee', category: 'Coffee', unit: 'pcs', price: '200', trackStock: false })).body;
  const plan = await s.api.put('/floor-plan', {
    floors: [{ name: 'Ground floor', width: 1200, height: 800, decor: [], tables: [table('T1', 40), table('T2', 200), table('T3', 400)] }],
  });
  assert.equal(plan.status, 200, JSON.stringify(plan.body));
  if (review) assert.equal((await s.api.put('/shop', { name: 'Game cafe', googleReviewUrl: PLACE_ID })).status, 200);
  const [t1, t2, t3] = plan.body.floors[0].tables.map((t: { qrToken: string }) => t.qrToken);
  return { ...s, coffee, t1, t2, t3 };
}

async function guest(tableToken: string, phone = nextPhone()) {
  const g = { name: `Guest ${phone.slice(-3)} Rao`, phone, email: `g-${randomUUID().slice(0, 8)}@example.test` };
  // Each guest from their own address, so the per-address code limit isn't hit.
  const sent = await client().post(`/public/tables/${tableToken}/code`, g, { 'X-Forwarded-For': `10.0.${phone.slice(-4, -2)}.${phone.slice(-2)}` });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  const code = /Subject: (\d{6}) is your code/.exec(lastMailTo(g.email))?.[1];
  const v = await client().post(`/public/tables/${tableToken}/verify`, { challenge: sent.body.challenge, code });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  const h = { 'X-Guest-Session': v.body.sessionToken };
  const c = client();
  const get = (p: string) => fetch(`${apiBase()}${p}`, { headers: h }).then(async (r) => ({ status: r.status, body: await r.json() }));
  return {
    ...g,
    discountPct: v.body.discountPct as number,
    order: (productId: number, extra: Record<string, unknown> = {}) =>
      c.post(`/public/tables/${tableToken}/orders`, { items: [{ productId, quantity: 1 }], idempotencyKey: randomUUID(), ...extra }, h),
    state: () => get(`/public/tables/${tableToken}/game`),
    practice: () => get(`/public/tables/${tableToken}/game/practice`),
    reviewed: () => c.post(`/public/tables/${tableToken}/review-opened`, {}, h),
    startRound: () => c.post(`/public/tables/${tableToken}/game/rounds`, {}, h),
    join: (id: number) => c.post(`/public/tables/${tableToken}/game/rounds/${id}/join`, {}, h),
    answer: (id: number, answers: number[]) => c.post(`/public/tables/${tableToken}/game/rounds/${id}/answers`, { answers }, h),
  };
}

/** Ordered and past the review step: ready to play. */
async function player(tableToken: string, coffeeId: number, extra: Record<string, unknown> = {}) {
  const g = await guest(tableToken);
  assert.equal((await g.order(coffeeId, extra)).status, 201);
  assert.equal((await g.reviewed()).status, 200);
  return g;
}

/** Skips the lobby wait: the round starts now. */
const startNow = (id: number) => sql(`UPDATE game_rounds SET starts_at = now() - interval '1 second', ends_at = now() + interval '44 seconds' WHERE id = $1`, [id]);
/** The right answer for the first `n` questions of a round, then `wrong` wrong ones. */
async function answersFor(roundId: number, n: number, wrong = 0) {
  const { makeQuestions } = await import('../src/modules/dinein/questions');
  const [{ seed }] = await sql(`SELECT seed FROM game_rounds WHERE id = $1`, [roundId]);
  const qs = makeQuestions(seed);
  return [...qs.slice(0, n).map((q) => q.answer), ...qs.slice(n, n + wrong).map((q) => (q.answer + 1) % 4)];
}

describe('Google review link', () => {
  test('Place ID or review links are kept as review links; other links are refused; blank clears; left out keeps', async () => {
    const { api } = await newShop('Review');
    const put = (googleReviewUrl?: string | null) => api.put('/shop', { name: 'Review', googleReviewUrl });
    assert.equal((await put(PLACE_ID)).body.googleReviewUrl, `https://search.google.com/local/writereview?placeid=${PLACE_ID}`);
    assert.equal((await put('https://g.page/r/CbXyz123AbC/review')).body.googleReviewUrl, 'https://g.page/r/CbXyz123AbC/review');
    assert.equal((await put(`search.google.com/local/writereview?placeid=${PLACE_ID}&x=1`)).body.googleReviewUrl, `https://search.google.com/local/writereview?placeid=${PLACE_ID}`);
    for (const bad of ['https://maps.app.goo.gl/abc123', 'https://evil.example/r/abc/review', 'javascript:alert(1)', 'not a link']) {
      const r = await put(bad);
      assert.equal(r.status, 400, bad);
      assert.match(r.body.error.details.googleReviewUrl, /Google Business Profile/);
    }
    assert.equal((await put(undefined)).body.googleReviewUrl, `https://search.google.com/local/writereview?placeid=${PLACE_ID}`);
    assert.equal((await put('')).body.googleReviewUrl, null);
  });
});

describe('review step, then the game', () => {
  test('locked until they order, then until they open the review page; asked once per customer', async () => {
    const { coffee, t1 } = await cafe();
    const g = await guest(t1);
    let s = (await g.state()).body;
    assert.equal(s.locked, 'order');
    assert.deepEqual(s.review, { url: `https://search.google.com/local/writereview?placeid=${PLACE_ID}`, done: false });
    assert.equal((await g.practice()).status, 403);

    await g.order(coffee.id);
    s = (await g.state()).body;
    assert.equal(s.locked, 'review');
    assert.equal((await g.startRound()).status, 403);

    s = (await g.reviewed()).body;
    assert.equal(s.locked, null);
    assert.equal(s.review.done, true);
    const p = (await g.practice()).body;
    assert.equal(p.seconds, 45);
    assert.equal(p.questions.length, 60);
    assert.ok(p.questions.every((q: { options: string[]; answer: number }) => q.options.length === 4 && q.answer >= 0 && q.answer < 4));

    // Same customer on another phone: already reviewed.
    const again = await guest(t1, g.phone);
    await again.order(coffee.id);
    assert.equal((await again.state()).body.locked, null);
  });

  test('no review link: the game opens straight after ordering', async () => {
    const { coffee, t1 } = await cafe(false);
    const g = await guest(t1);
    await g.order(coffee.id);
    const s = (await g.state()).body;
    assert.equal(s.review, null);
    assert.equal(s.locked, null);
  });

  test('without a session there is nothing to see', async () => {
    const { t1 } = await cafe();
    assert.equal((await client().get(`/public/tables/${t1}/game`)).status, 401);
  });
});

describe('table challenge', () => {
  test('two tables play; answers are marked on the server; the winner gets 10% off their unpaid order', async () => {
    const { coffee, t1, t2, t3, api } = await cafe(false);
    const a = await player(t1, coffee.id); // first order: 15% off
    const b = await player(t2, coffee.id);
    const watcher = await player(t3, coffee.id);

    const started = await a.startRound();
    assert.equal(started.status, 201, JSON.stringify(started.body));
    const round = started.body.round;
    assert.equal(round.status, 'lobby');
    assert.equal(round.joined, true);
    assert.equal(round.questions, null);
    assert.ok(round.startsInSeconds > 80 && round.startsInSeconds <= 90);

    // A second "start" from another table joins the open round instead.
    assert.equal((await b.startRound()).body.round.id, round.id);
    let s = (await watcher.state()).body.round;
    assert.equal(s.joined, false);
    assert.deepEqual(s.players.map((p: { name: string; tableLabel: string }) => [p.name, p.tableLabel]), [
      ['Guest', 'T1'],
      ['Guest', 'T2'],
    ]);

    await startNow(round.id);
    assert.equal((await watcher.join(round.id)).status, 409);
    assert.equal((await watcher.state()).body.round.questions, null);
    const qs = (await a.state()).body.round.questions;
    assert.equal(qs.length, 60);
    assert.ok(qs.every((q: Record<string, unknown>) => !('answer' in q)));
    assert.equal((await a.startRound()).status, 409);

    // a: 12 right, 2 wrong = 10. b: 8 right = 8.
    const first = await a.answer(round.id, await answersFor(round.id, 12, 2));
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.round.status, 'playing');
    const mine = first.body.round.players.find((p: { me: boolean }) => p.me);
    assert.deepEqual([mine.correct, mine.wrong, mine.score], [12, 2, null]);
    assert.equal((await a.answer(round.id, [0])).status, 409);

    // Everyone's in: results straight away.
    s = (await b.answer(round.id, await answersFor(round.id, 8))).body.round;
    assert.equal(s.status, 'finished');
    assert.deepEqual(s.players.map((p: { tableLabel: string; score: number; winner: boolean }) => [p.tableLabel, p.score, p.winner]), [
      ['T1', 10, true],
      ['T2', 8, false],
    ]);
    assert.equal(s.myPrize, null);

    // a's ₹200 order: 15% first-order (₹30) + 10% prize (₹20) = ₹150.
    const aState = (await a.state()).body.round;
    assert.deepEqual(aState.myPrize, { pct: 10, appliedPaise: 2000 });
    const [o] = await sql(
      `SELECT o.discount_paise::int AS d, o.total_paise::int AS t, o.payment_status AS ps, o.guest_token AS gt
       FROM orders o JOIN customers c ON c.id = o.customer_id WHERE c.phone = $1`,
      [a.phone],
    );
    assert.deepEqual([o.d, o.t, o.ps], [5000, 15000, 'unpaid']);
    const view = (await client().get(`/public/table-orders/${o.gt}`)).body;
    assert.deepEqual([view.discountPaise, view.prizePaise, view.totalPaise], [5000, 2000, 15000]);

    // Staff marking it paid takes the reduced total.
    const k = (await api.get('/kitchen')).body.find((x: { orderNumber: string }) => x.orderNumber === view.orderNumber);
    await api.post(`/kitchen/${k.id}/paid`, { method: 'cash' });
    const [paid] = await sql(`SELECT amount_paid_paise::int AS p FROM orders WHERE guest_token = $1`, [o.gt]);
    assert.equal(paid.p, 15000);

    // A new round can start once this one's over.
    assert.equal((await watcher.startRound()).status, 201);
  });

  test('fewer than two tables: called off, no prize', async () => {
    const { coffee, t1 } = await cafe(false);
    const a = await player(t1, coffee.id);
    const b = await player(t1, coffee.id);
    const id = (await a.startRound()).body.round.id;
    await b.join(id);
    await startNow(id);
    const s = (await a.state()).body.round;
    assert.equal(s.status, 'called_off');
    assert.equal(s.questions, null);
    assert.equal((await a.answer(id, [0])).status, 409);
  });

  test('a winner with nothing unpaid gets the prize on their next order; a zero score wins nothing', async () => {
    const { coffee, t1, t2 } = await cafe(false);
    const a = await player(t1, coffee.id, { paid: true });
    const b = await player(t2, coffee.id);
    const id = (await a.startRound()).body.round.id;
    await b.join(id);
    await startNow(id);
    await a.answer(id, await answersFor(id, 5));
    // b taps at random: more wrong than right, score 0.
    const s = (await b.answer(id, await answersFor(id, 1, 6))).body.round;
    assert.equal(s.status, 'finished');
    assert.deepEqual(s.players.map((p: { score: number }) => p.score), [5, 0]);

    let st = (await a.state()).body;
    assert.deepEqual(st.round.myPrize, { pct: 10, appliedPaise: 0 });
    assert.equal(st.pendingPrizePct, 10);

    // Next order (no first-order discount any more): ₹200 - 10%.
    const next = await a.order(coffee.id);
    assert.equal(next.status, 201);
    assert.equal(next.body.discountPaise, 2000);
    st = (await a.state()).body;
    assert.equal(st.pendingPrizePct, 0);
    assert.deepEqual(st.round.myPrize, { pct: 10, appliedPaise: 2000 });
    // Used once only.
    assert.equal((await a.order(coffee.id)).body.discountPaise, 0);
  });

  test('time runs out: late answers are refused and results are counted without them', async () => {
    const { coffee, t1, t2 } = await cafe(false);
    const a = await player(t1, coffee.id);
    const b = await player(t2, coffee.id);
    const id = (await a.startRound()).body.round.id;
    await b.join(id);
    await startNow(id);
    await a.answer(id, await answersFor(id, 3));
    await sql(`UPDATE game_rounds SET starts_at = now() - interval '2 minutes', ends_at = now() - interval '11 seconds' WHERE id = $1`, [id]);
    assert.equal((await b.answer(id, await answersFor(id, 20))).status, 409);
    const s = (await b.state()).body.round;
    assert.equal(s.status, 'finished');
    assert.deepEqual(s.players.map((p: { tableLabel: string; score: number | null; winner: boolean }) => [p.tableLabel, p.score, p.winner]), [
      ['T1', 3, true],
      ['T2', null, false],
    ]);
  });
});

describe('questions', () => {
  test('same seed, same questions; four different options with the answer among them', async () => {
    const { makeQuestions, mark } = await import('../src/modules/dinein/questions');
    for (let seed = 1; seed < 400; seed++) {
      const qs = makeQuestions(seed);
      assert.deepEqual(makeQuestions(seed), qs);
      for (const q of qs) {
        assert.equal(new Set(q.options).size, 4, JSON.stringify(q));
        assert.ok(q.answer >= 0 && q.answer < 4);
        if (q.kind === 'sum') {
          const [x, op, y] = q.prompt.split(' ');
          const v = op === '+' ? +x + +y : op === '−' ? +x - +y : +x * +y;
          assert.equal(q.options[q.answer], String(v), q.prompt);
        }
        if (q.kind === 'max') assert.equal(q.options[q.answer], String(Math.max(...q.options.map(Number))));
        if (q.kind === 'count') assert.equal(q.options[q.answer], String(q.count));
        if (q.kind === 'ink') assert.equal(q.options[q.answer], q.ink);
      }
    }
    const qs = makeQuestions(7);
    assert.deepEqual(mark(7, qs.slice(0, 4).map((q) => q.answer)), { correct: 4, wrong: 0, score: 4 });
    assert.deepEqual(mark(7, qs.slice(0, 4).map((q) => (q.answer + 1) % 4)), { correct: 0, wrong: 4, score: 0 });
  });
});
