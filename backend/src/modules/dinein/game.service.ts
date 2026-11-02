import { randomInt } from 'crypto';
import { Db, pool } from '../../db/pool';
import { withTransaction } from '../../db/tx';
import { AppError } from '../../lib/errors';
import { discountFor, findSession, GuestSession, pendingPrize, SESSION_HOURS, sessionNeeded, tableOr404 } from './guest.service';
import { makeQuestions, mark, QUESTION_COUNT, withoutAnswers } from './questions';

/**
 * After ordering from a table: rate the branch on Google (when it has a review link), then play.
 * Guests can practise alone, or start a table challenge: other tables have LOBBY_SECONDS to join,
 * everyone answers the same questions for PLAY_SECONDS, and the top score wins PRIZE_PCT off.
 */
export const PRIZE_PCT = 10;
export const LOBBY_SECONDS = 90;
export const PLAY_SECONDS = 45;
/** Answers sent this long after the end still count (slow phones, café Wi-Fi). */
const GRACE_SECONDS = 10;
/** A finished round stays on screen this long. */
const SHOW_RESULT_MINUTES = 15;

type Locked = 'order' | 'review' | null;

async function guestAt(tableToken: string, sessionToken: string | undefined) {
  const table = await tableOr404(tableToken);
  const session = await findSession(pool, table.shopId, sessionToken);
  if (!session) throw sessionNeeded();
  return { table, session };
}

/** The review step (null when the branch has no review link) and whether the game is open to this guest yet. */
async function access(db: Db, s: GuestSession) {
  const { rows } = await db.query(
    `SELECT sh.google_review_url AS url,
       EXISTS (SELECT 1 FROM guest_sessions g WHERE g.customer_id = $2 AND g.review_opened_at IS NOT NULL) AS reviewed,
       EXISTS (SELECT 1 FROM orders o WHERE o.shop_id = $1 AND o.customer_id = $2 AND o.source = 'table' AND o.status <> 'cancelled'
               AND o.created_at > now() - interval '${SESSION_HOURS} hours') AS ordered
     FROM shops sh WHERE sh.id = $1`,
    [s.shopId, s.customerId],
  );
  const { url, reviewed, ordered } = rows[0] as { url: string | null; reviewed: boolean; ordered: boolean };
  const review = url ? { url, done: reviewed } : null;
  const locked: Locked = !ordered ? 'order' : review && !review.done ? 'review' : null;
  return { review, locked };
}

const lockedError = (locked: Locked) =>
  locked === 'order'
    ? new AppError(403, 'GAME_LOCKED', 'Place an order first, then the game opens.')
    : new AppError(403, 'GAME_LOCKED', 'Rate us on Google first, then the game opens.');

/** The guest has been sent to the review page: the game opens. Asked once per customer. */
export async function reviewOpened(tableToken: string, sessionToken: string | undefined) {
  const { session } = await guestAt(tableToken, sessionToken);
  await pool.query(`UPDATE guest_sessions SET review_opened_at = COALESCE(review_opened_at, now()) WHERE id = $1`, [session.id]);
  return gameState(tableToken, sessionToken);
}

// ---------------------------------------------------------------------------------------------
// Rounds
// ---------------------------------------------------------------------------------------------

interface Round {
  id: number;
  shopId: number;
  seed: number;
  startsAt: string;
  endsAt: string;
  finalizedAt: string | null;
  calledOff: boolean;
  /** Seconds, by the database clock. */
  toStart: number;
  toEnd: number;
  tables: number;
  players: number;
  submitted: number;
}

const ROUND_COLS = `r.id, r.shop_id AS "shopId", r.seed, r.starts_at AS "startsAt", r.ends_at AS "endsAt",
  r.finalized_at AS "finalizedAt", r.called_off AS "calledOff",
  EXTRACT(EPOCH FROM r.starts_at - now())::float AS "toStart", EXTRACT(EPOCH FROM r.ends_at - now())::float AS "toEnd",
  (SELECT count(DISTINCT e.table_label)::int FROM game_entries e WHERE e.round_id = r.id) AS tables,
  (SELECT count(*)::int FROM game_entries e WHERE e.round_id = r.id) AS players,
  (SELECT count(*)::int FROM game_entries e WHERE e.round_id = r.id AND e.submitted_at IS NOT NULL) AS submitted`;

/** The branch's latest round, if it's still running or finished in the last few minutes. */
async function latestRound(db: Db, shopId: number, lock = false): Promise<Round | null> {
  const { rows } = await db.query(
    `SELECT ${ROUND_COLS} FROM game_rounds r
     WHERE r.shop_id = $1 AND r.ends_at > now() - interval '${SHOW_RESULT_MINUTES} minutes'
     ORDER BY r.ends_at DESC, r.id DESC LIMIT 1 ${lock ? 'FOR UPDATE OF r' : ''}`,
    [shopId],
  );
  return rows[0] ?? null;
}

type Status = 'lobby' | 'playing' | 'counting' | 'finished' | 'called_off';
function statusOf(r: Round): Status {
  if (r.calledOff) return 'called_off';
  if (r.finalizedAt) return 'finished';
  if (r.toStart > 0) return 'lobby';
  return r.toEnd > 0 ? 'playing' : 'counting';
}

/** Results are due once the round can't change: it started with too few tables, or every answer is in, or time's up. */
const isDue = (r: Round) => !r.finalizedAt && r.toStart <= 0 && (r.tables < 2 || r.submitted === r.players || r.toEnd <= -GRACE_SECONDS);

/**
 * Counts the results once: called off with fewer than two tables, otherwise the best score above 0
 * wins (fewer wrong answers, then the earlier answers, break a tie) and the prize is taken off the
 * winner's unpaid table orders. Runs whenever someone looks at a due round; the row lock makes it once.
 */
async function finalizeIfDue(shopId: number) {
  const r = await latestRound(pool, shopId);
  if (!r || !isDue(r)) return;
  await withTransaction(async (c) => {
    const locked = await latestRound(c, shopId, true);
    if (!locked || locked.id !== r.id || !isDue(locked)) return;
    if (locked.tables < 2) {
      await c.query(`UPDATE game_rounds SET called_off = true, finalized_at = now() WHERE id = $1`, [r.id]);
      return;
    }
    const { rows } = await c.query(
      `SELECT id, customer_id AS "customerId" FROM game_entries
       WHERE round_id = $1 AND score > 0 ORDER BY score DESC, wrong, submitted_at, id LIMIT 1`,
      [r.id],
    );
    if (rows[0]) {
      await c.query(`UPDATE game_entries SET prize_pct = $2 WHERE id = $1`, [rows[0].id, PRIZE_PCT]);
      await applyPrize(c, shopId, { id: Number(rows[0].id), customerId: Number(rows[0].customerId), pct: PRIZE_PCT });
    }
    await c.query(`UPDATE game_rounds SET finalized_at = now() WHERE id = $1`, [r.id]);
  });
}

/**
 * Takes the prize off the winner's table orders that are still open and not paid at all (so no
 * payment is ever more than the new total). If there are none yet, the prize stays for their next order.
 */
async function applyPrize(c: Db, shopId: number, entry: { id: number; customerId: number; pct: number }) {
  const { rows } = await c.query(
    `SELECT id, subtotal_paise AS "subtotal", discount_paise AS "discount" FROM orders
     WHERE shop_id = $1 AND customer_id = $2 AND source = 'table' AND status = 'open' AND amount_paid_paise = 0
       AND created_at > now() - interval '${SESSION_HOURS} hours'
     ORDER BY id FOR UPDATE`,
    [shopId, entry.customerId],
  );
  let used = false;
  for (const o of rows as { id: number; subtotal: string; discount: string }[]) {
    const subtotal = Number(o.subtotal);
    const discount = Number(o.discount);
    const prize = Math.min(discountFor(subtotal, entry.pct), subtotal - discount);
    if (prize <= 0) continue;
    const total = subtotal - discount - prize;
    await c.query(
      `UPDATE orders SET discount_paise = $3, total_paise = $4, payment_status = (CASE WHEN $4::bigint = 0 THEN 'paid' ELSE 'unpaid' END)::payment_status,
         version = version + 1, updated_at = now()
       WHERE shop_id = $1 AND id = $2`,
      [shopId, o.id, discount + prize, total],
    );
    await c.query(`INSERT INTO game_prizes (entry_id, order_id, amount_paise) VALUES ($1, $2, $3)`, [entry.id, o.id, prize]);
    used = true;
  }
  if (used) await c.query(`UPDATE game_entries SET prize_used_at = now() WHERE id = $1 AND prize_used_at IS NULL`, [entry.id]);
}

// ---------------------------------------------------------------------------------------------
// What the guest sees
// ---------------------------------------------------------------------------------------------

const firstName = (n: string) => n.trim().split(/\s+/)[0];

export async function gameState(tableToken: string, sessionToken: string | undefined) {
  const { table, session } = await guestAt(tableToken, sessionToken);
  await finalizeIfDue(table.shopId);
  const [{ review, locked }, r, prize] = await Promise.all([access(pool, session), latestRound(pool, table.shopId), pendingPrize(pool, session.customerId)]);

  let round = null;
  if (r) {
    const status = statusOf(r);
    const { rows: entries } = await pool.query(
      `SELECT e.id, e.customer_id AS "customerId", e.name, e.table_label AS "tableLabel", e.correct, e.wrong, e.score,
         e.submitted_at IS NOT NULL AS submitted, e.prize_pct AS "prizePct",
         COALESCE((SELECT sum(p.amount_paise) FROM game_prizes p WHERE p.entry_id = e.id), 0)::int AS "prizePaise"
       FROM game_entries e WHERE e.round_id = $1
       ORDER BY e.score DESC NULLS LAST, e.wrong NULLS LAST, e.submitted_at NULLS LAST, e.id`,
      [r.id],
    );
    const mine = entries.find((e: { customerId: number }) => Number(e.customerId) === Number(session.customerId));
    const showScores = status === 'finished';
    round = {
      id: Number(r.id),
      status,
      startsInSeconds: Math.max(0, r.toStart),
      endsInSeconds: Math.max(0, r.toEnd),
      tables: r.tables,
      joined: !!mine,
      submitted: !!mine?.submitted,
      // Only while playing, only to players still answering. Never the answers.
      questions: status === 'playing' && mine && !mine.submitted ? withoutAnswers(makeQuestions(r.seed)) : null,
      players: entries.map((e: { customerId: number; name: string; tableLabel: string; correct: number | null; wrong: number | null; score: number | null; prizePct: number }) => ({
        name: firstName(e.name),
        tableLabel: e.tableLabel,
        me: Number(e.customerId) === Number(session.customerId),
        // Kept hidden until everyone's done, so nobody knows the score to beat.
        score: showScores ? e.score : null,
        correct: showScores || Number(e.customerId) === Number(session.customerId) ? e.correct : null,
        wrong: showScores || Number(e.customerId) === Number(session.customerId) ? e.wrong : null,
        winner: e.prizePct > 0,
      })),
      // The prize this guest won in this round: how much came off their orders so far.
      myPrize: mine && mine.prizePct > 0 ? { pct: mine.prizePct, appliedPaise: mine.prizePaise } : null,
    };
  }

  return {
    review,
    locked,
    tableLabel: table.label,
    prizePct: PRIZE_PCT,
    lobbySeconds: LOBBY_SECONDS,
    playSeconds: PLAY_SECONDS,
    pendingPrizePct: prize?.pct ?? 0,
    round,
  };
}

// ---------------------------------------------------------------------------------------------
// Playing
// ---------------------------------------------------------------------------------------------

async function playable(tableToken: string, sessionToken: string | undefined) {
  const g = await guestAt(tableToken, sessionToken);
  const { locked } = await access(pool, g.session);
  if (locked) throw lockedError(locked);
  return g;
}

/** Practice on your own: new questions every time, with the answers (nothing to win). */
export async function practice(tableToken: string, sessionToken: string | undefined) {
  await playable(tableToken, sessionToken);
  return { seconds: PLAY_SECONDS, questions: makeQuestions(randomInt(1, 2 ** 31 - 1)) };
}

async function addEntry(c: Db, roundId: number, table: { id: number; label: string }, s: GuestSession) {
  await c.query(
    `INSERT INTO game_entries (round_id, guest_session_id, customer_id, table_id, table_label, name)
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (round_id, customer_id) DO NOTHING`,
    [roundId, s.id, s.customerId, table.id, table.label, s.name],
  );
}

/** Opens a round for the whole branch (the starter is in it), or joins the one that's already open. */
export async function startChallenge(tableToken: string, sessionToken: string | undefined) {
  const { table, session } = await playable(tableToken, sessionToken);
  await finalizeIfDue(table.shopId);
  await withTransaction(async (c) => {
    // One round at a time per branch.
    await c.query(`SELECT id FROM shops WHERE id = $1 FOR UPDATE`, [table.shopId]);
    const r = await latestRound(c, table.shopId);
    const status = r && statusOf(r);
    if (r && status === 'lobby') return addEntry(c, r.id, table, session);
    if (status === 'playing' || status === 'counting') {
      throw new AppError(409, 'ROUND_RUNNING', 'A round is being played right now. Start the next one when it ends.');
    }
    const { rows } = await c.query(
      `INSERT INTO game_rounds (shop_id, seed, starts_at, ends_at)
       VALUES ($1, $2, now() + interval '${LOBBY_SECONDS} seconds', now() + interval '${LOBBY_SECONDS + PLAY_SECONDS} seconds') RETURNING id`,
      [table.shopId, randomInt(1, 2 ** 31 - 1)],
    );
    await addEntry(c, rows[0].id, table, session);
  });
  return gameState(tableToken, sessionToken);
}

export async function joinChallenge(tableToken: string, sessionToken: string | undefined, roundId: number) {
  const { table, session } = await playable(tableToken, sessionToken);
  await withTransaction(async (c) => {
    const r = await latestRound(c, table.shopId, true);
    if (!r || Number(r.id) !== roundId) throw new AppError(404, 'NOT_FOUND', 'This round is over. Start a new one.');
    if (statusOf(r) !== 'lobby') throw new AppError(409, 'ROUND_STARTED', 'This round has already started. Join the next one.');
    await addEntry(c, r.id, table, session);
  });
  return gameState(tableToken, sessionToken);
}

/** One go per player: the answers (option index per question, in order) are marked here, never trusted. */
export async function submitAnswers(tableToken: string, sessionToken: string | undefined, roundId: number, answers: number[]) {
  const { table, session } = await guestAt(tableToken, sessionToken);
  const r = await latestRound(pool, table.shopId);
  if (!r || Number(r.id) !== roundId) throw new AppError(404, 'NOT_FOUND', 'This round is over.');
  const status = statusOf(r);
  if (status === 'lobby') throw new AppError(409, 'ROUND_NOT_STARTED', "This round hasn't started yet.");
  if (status !== 'playing' && !(status === 'counting' && r.toEnd > -GRACE_SECONDS)) {
    throw new AppError(409, 'ROUND_OVER', 'Time ran out before your answers arrived.');
  }
  const { correct, wrong, score } = mark(r.seed, answers.slice(0, QUESTION_COUNT));
  const { rowCount } = await pool.query(
    `UPDATE game_entries SET correct = $3, wrong = $4, score = $5, submitted_at = now()
     WHERE round_id = $1 AND customer_id = $2 AND submitted_at IS NULL`,
    [r.id, session.customerId, correct, wrong, score],
  );
  if (!rowCount) {
    const { rows } = await pool.query(`SELECT 1 FROM game_entries WHERE round_id = $1 AND customer_id = $2`, [r.id, session.customerId]);
    throw rows.length
      ? new AppError(409, 'ALREADY_SUBMITTED', 'Your answers are already in.')
      : new AppError(403, 'NOT_IN_ROUND', "You didn't join this round.");
  }
  return gameState(tableToken, sessionToken);
}
