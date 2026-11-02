import { randomInt } from 'crypto';
import { Db } from '../../db/pool';
import { withTransaction } from '../../db/tx';
import { AppError } from '../../lib/errors';
import type { GuestSession } from './guest.service';
import { pickWord } from './words';

/**
 * Traitor, for the people at one table: everyone's phone shows the secret word except the
 * traitor's, which shows only the category. They give one-word clues out loud, then vote on their
 * phones; the traitor is caught if they get the most votes outright. Nothing to win. The game is
 * played at the table, so the server only deals the cards, keeps the secret and counts the votes.
 */
export const PARTY_MIN_PLAYERS = 3;
export const PARTY_MAX_PLAYERS = 12;
/** A table's last game stays on screen this long. */
const SHOW_HOURS = 3;
/** A game nobody finished: after this, anyone at the table may start a new one. */
const STALE_MINUTES = 20;

interface Table {
  id: number;
  shopId: number;
}

interface Game {
  id: number;
  category: string | null;
  word: string | null;
  dealtAt: string | null;
  revealedAt: string | null;
  stale: boolean;
}

type Status = 'lobby' | 'playing' | 'revealed';
const statusOf = (g: Game): Status => (g.revealedAt ? 'revealed' : g.dealtAt ? 'playing' : 'lobby');

const GAME_COLS = `id, category, word, dealt_at AS "dealtAt", revealed_at AS "revealedAt",
  (dealt_at IS NOT NULL AND revealed_at IS NULL AND dealt_at < now() - interval '${STALE_MINUTES} minutes') AS stale`;

async function latestGame(db: Db, tableId: number): Promise<Game | null> {
  const { rows } = await db.query(
    `SELECT ${GAME_COLS} FROM party_games WHERE table_id = $1 AND created_at > now() - interval '${SHOW_HOURS} hours'
     ORDER BY id DESC LIMIT 1`,
    [tableId],
  );
  return rows[0] ?? null;
}

interface Player {
  id: number;
  customerId: number;
  name: string;
  traitor: boolean;
  voteFor: number | null;
}

async function playersOf(db: Db, gameId: number): Promise<Player[]> {
  const { rows } = await db.query(
    `SELECT id, customer_id AS "customerId", name, traitor, vote_for AS "voteFor" FROM party_players WHERE game_id = $1 ORDER BY joined_at, id`,
    [gameId],
  );
  return rows.map((p) => ({ ...p, id: Number(p.id), customerId: Number(p.customerId), voteFor: p.voteFor === null ? null : Number(p.voteFor) }));
}

/** First names; when two players share one, their last initial too. */
function shortNames(players: Player[]) {
  const first = (n: string) => n.trim().split(/\s+/)[0];
  const count = new Map<string, number>();
  for (const p of players) count.set(first(p.name), (count.get(first(p.name)) ?? 0) + 1);
  return players.map((p) => {
    const parts = p.name.trim().split(/\s+/);
    return (count.get(parts[0]) ?? 0) > 1 && parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
  });
}

/** Caught = the traitor got more votes than anyone else. */
function tally(players: Player[]) {
  const votes = new Map<number, number>();
  for (const p of players) if (p.voteFor !== null) votes.set(p.voteFor, (votes.get(p.voteFor) ?? 0) + 1);
  const traitor = players.find((p) => p.traitor);
  const theirs = traitor ? (votes.get(traitor.id) ?? 0) : 0;
  const caught = !!traitor && theirs > 0 && players.every((p) => p.traitor || (votes.get(p.id) ?? 0) < theirs);
  return { votes, traitor, caught };
}

/** The table's game as this guest sees it: the word only on their own card, votes only once revealed. */
export async function partyState(db: Db, table: Table, s: GuestSession) {
  const g = await latestGame(db, table.id);
  if (!g) return null;
  const status = statusOf(g);
  const players = await playersOf(db, g.id);
  const names = shortNames(players);
  const me = players.find((p) => p.customerId === Number(s.customerId));
  const revealed = status === 'revealed';
  const { votes, traitor, caught } = tally(players);
  return {
    id: Number(g.id),
    status,
    // A game left unfinished: a new one can be started over it.
    stale: g.stale,
    joined: !!me,
    minPlayers: PARTY_MIN_PLAYERS,
    maxPlayers: PARTY_MAX_PLAYERS,
    players: players.map((p, i) => ({
      id: p.id,
      name: names[i],
      me: p === me,
      voted: p.voteFor !== null,
      votes: revealed ? (votes.get(p.id) ?? 0) : null,
      traitor: revealed ? p.traitor : null,
    })),
    card:
      me && status !== 'lobby'
        ? { traitor: me.traitor, category: g.category as string, word: me.traitor && !revealed ? null : (g.word as string) }
        : null,
    myVote: me?.voteFor ?? null,
    result: revealed && traitor ? { traitor: names[players.indexOf(traitor)], word: g.word as string, caught } : null,
  };
}

const over = () => new AppError(404, 'NOT_FOUND', 'This game is over. Start a new one.');

async function addPlayer(c: Db, gameId: number, s: GuestSession) {
  const { rows } = await c.query(`SELECT count(*)::int AS n FROM party_players WHERE game_id = $1`, [gameId]);
  if (rows[0].n >= PARTY_MAX_PLAYERS) throw new AppError(409, 'PARTY_FULL', `A game takes up to ${PARTY_MAX_PLAYERS} players.`);
  await c.query(
    `INSERT INTO party_players (game_id, guest_session_id, customer_id, name) VALUES ($1, $2, $3, $4) ON CONFLICT (game_id, customer_id) DO NOTHING`,
    [gameId, s.id, s.customerId, s.name],
  );
}

/**
 * Opens a game at this table (or joins the one waiting to start). After a reveal, "play again"
 * brings everyone from the last game along, so nobody has to join again.
 */
export async function startParty(table: Table, s: GuestSession) {
  await withTransaction(async (c) => {
    // One game at a time per table.
    await c.query(`SELECT id FROM dining_tables WHERE id = $1 FOR UPDATE`, [table.id]);
    const g = await latestGame(c, table.id);
    const status = g && statusOf(g);
    if (g && status === 'lobby') return addPlayer(c, g.id, s);
    if (g && status === 'playing' && !g.stale) {
      throw new AppError(409, 'PARTY_RUNNING', 'A game is on at your table. Join the next one when it ends.');
    }
    const { rows } = await c.query(`INSERT INTO party_games (shop_id, table_id) VALUES ($1, $2) RETURNING id`, [table.shopId, table.id]);
    const id = Number(rows[0].id);
    await addPlayer(c, id, s);
    if (g && status === 'revealed') {
      await c.query(
        `INSERT INTO party_players (game_id, guest_session_id, customer_id, name)
         SELECT $1, guest_session_id, customer_id, name FROM party_players WHERE game_id = $2 ORDER BY joined_at, id
         ON CONFLICT (game_id, customer_id) DO NOTHING`,
        [id, g.id],
      );
    }
  });
}

/** Locks the game and finds this guest in it. */
async function lockGame(c: Db, table: Table, s: GuestSession, gameId: number) {
  const { rows } = await c.query(`SELECT ${GAME_COLS} FROM party_games WHERE id = $1 AND table_id = $2 FOR UPDATE`, [gameId, table.id]);
  const g = rows[0] as Game | undefined;
  if (!g) throw over();
  const players = await playersOf(c, gameId);
  const me = players.find((p) => p.customerId === Number(s.customerId));
  return { g, status: statusOf(g), players, me };
}

const notIn = () => new AppError(403, 'NOT_IN_GAME', "You're not in this game. Join the next one.");

export async function joinParty(table: Table, s: GuestSession, gameId: number) {
  await withTransaction(async (c) => {
    const { status } = await lockGame(c, table, s, gameId);
    if (status !== 'lobby') throw new AppError(409, 'PARTY_STARTED', 'This game has already started. Join the next one.');
    await addPlayer(c, gameId, s);
  });
}

/** Deals the cards: a random word, and one random traitor. Any player can deal once enough have joined. */
export async function dealParty(table: Table, s: GuestSession, gameId: number) {
  await withTransaction(async (c) => {
    const { status, players, me } = await lockGame(c, table, s, gameId);
    if (!me) throw notIn();
    if (status !== 'lobby') throw new AppError(409, 'PARTY_STARTED', 'The cards are already dealt.');
    if (players.length < PARTY_MIN_PLAYERS) {
      throw new AppError(409, 'NOT_ENOUGH_PLAYERS', `Traitor needs at least ${PARTY_MIN_PLAYERS} players. Ask the others at your table to join.`);
    }
    const { category, word } = pickWord();
    await c.query(`UPDATE party_games SET category = $2, word = $3, dealt_at = now() WHERE id = $1`, [gameId, category, word]);
    await c.query(`UPDATE party_players SET traitor = true WHERE id = $1`, [players[randomInt(players.length)].id]);
  });
}

/** A vote can change until the reveal, which happens by itself once everyone has voted. */
export async function voteParty(table: Table, s: GuestSession, gameId: number, playerId: number) {
  await withTransaction(async (c) => {
    const { status, players, me } = await lockGame(c, table, s, gameId);
    if (!me) throw notIn();
    if (status !== 'playing') throw new AppError(409, 'PARTY_NOT_PLAYING', status === 'lobby' ? "The cards aren't dealt yet." : 'The votes are already counted.');
    if (!players.some((p) => p.id === playerId)) throw new AppError(400, 'BAD_VOTE', 'Vote for someone in this game.');
    if (playerId === me.id) throw new AppError(400, 'BAD_VOTE', "You can't vote for yourself.");
    await c.query(`UPDATE party_players SET vote_for = $2 WHERE id = $1`, [me.id, playerId]);
    const waiting = players.filter((p) => p.id !== me.id && p.voteFor === null).length;
    if (waiting === 0) await c.query(`UPDATE party_games SET revealed_at = now() WHERE id = $1`, [gameId]);
  });
}

/** Counts the votes now, even if someone hasn't voted. */
export async function revealParty(table: Table, s: GuestSession, gameId: number) {
  await withTransaction(async (c) => {
    const { status, me } = await lockGame(c, table, s, gameId);
    if (!me) throw notIn();
    if (status !== 'playing') throw new AppError(409, 'PARTY_NOT_PLAYING', status === 'lobby' ? "The cards aren't dealt yet." : 'The votes are already counted.');
    await c.query(`UPDATE party_games SET revealed_at = now() WHERE id = $1`, [gameId]);
  });
}
