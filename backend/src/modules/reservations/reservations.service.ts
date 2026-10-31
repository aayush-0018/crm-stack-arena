import { randomBytes } from 'crypto';
import { Db, pool } from '../../db/pool';
import { withTransaction } from '../../db/tx';
import { AppError, notFound } from '../../lib/errors';
import { customerFor, useCode } from '../dinein/guest.service';
import { findShop } from '../shop/shop.repo';
import { queueBookingMail } from './reservations.mail';
import {
  addDays,
  clock,
  findByManageToken,
  findReservation,
  fromMinutes,
  HOLDING,
  istDate,
  istInstant,
  ReservationSettings,
  ReservationStatus,
  toMinutes,
  weekday,
} from './reservations.repo';
import { BookingConfirm, ReservationInput } from './reservations.schemas';

const newToken = () => randomBytes(18).toString('base64url');

/** One booking change at a time per branch, so two people can't take the same table at once. */
const lockBranch = (c: Db, shopId: number) => c.query(`SELECT pg_advisory_xact_lock(hashtextextended('reservations:' || $1::text, 0))`, [shopId]);

interface Table {
  id: number;
  label: string;
  seats: number;
}

/** Active tables, smallest first (so a couple doesn't take the big table). */
async function activeTables(db: Db, shopId: number): Promise<Table[]> {
  const { rows } = await db.query(
    `SELECT t.id, t.label, t.seats FROM dining_tables t LEFT JOIN floors f ON f.id = t.floor_id
     WHERE t.shop_id = $1 AND t.active ORDER BY t.seats, f.position NULLS LAST, t.id`,
    [shopId],
  );
  return rows.map((t: Table) => ({ ...t, id: Number(t.id) }));
}

interface Hold {
  tableIds: number[];
  name: string;
  startsAt: Date;
  endsAt: Date;
}

/** Bookings holding tables at any point between `from` and `to`. */
async function holds(db: Db, shopId: number, from: Date, to: Date, exceptId: number | null): Promise<Hold[]> {
  const { rows } = await db.query(
    `SELECT table_ids AS "tableIds", name, starts_at AS "startsAt", ends_at AS "endsAt" FROM reservations
     WHERE shop_id = $1 AND status IN ${HOLDING} AND starts_at < $3 AND ends_at > $2 AND id IS DISTINCT FROM $4`,
    [shopId, from, to, exceptId],
  );
  return rows.map((h: Hold) => ({ ...h, tableIds: h.tableIds.map(Number) }));
}

/**
 * The smallest free table that seats the party, or null. Bookings without a table still need one,
 * so there must be more free tables than those.
 */
function pickTable(tables: Table[], overlapping: Hold[], party: number): Table | null {
  const busy = new Set(overlapping.flatMap((h) => h.tableIds));
  const waiting = overlapping.filter((h) => !h.tableIds.length).length;
  const free = tables.filter((t) => t.seats >= party && !busy.has(t.id));
  return free.length > waiting ? free[0] : null;
}

/** The tables the booking will hold: the ones chosen (if free), or the best free one, or none. */
async function placeTables(c: Db, shopId: number, chosen: number[], party: number, start: Date, end: Date, exceptId: number | null) {
  const tables = await activeTables(c, shopId);
  const overlapping = await holds(c, shopId, start, end, exceptId);
  if (!chosen.length) {
    const t = pickTable(tables, overlapping, party);
    return t ? [t.id] : [];
  }
  const byId = new Map(tables.map((t) => [t.id, t]));
  const ids = [...new Set(chosen)];
  if (ids.some((id) => !byId.has(id))) throw new AppError(409, 'TABLE_GONE', 'One of those tables is no longer on the floor plan. Please pick again.');
  for (const h of overlapping) {
    const clash = h.tableIds.find((id) => ids.includes(id));
    if (clash) {
      throw new AppError(409, 'TABLE_BOOKED', `${byId.get(clash)!.label} is booked ${clock(h.startsAt)} – ${clock(h.endsAt)} (${h.name}). Pick another table or time.`, {
        tableIds: 'That table is already booked then',
      });
    }
  }
  return ids;
}

const span = (date: string, time: string, minutes: number) => {
  const start = istInstant(date, time);
  return { start, end: new Date(start.getTime() + minutes * 60_000) };
};

// ---------------------------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------------------------

/** A booking taken by staff. With no table chosen, the best free one is given (if any). */
export async function createReservation(shopId: number, userId: number, input: ReservationInput) {
  const { start, end } = span(input.date, input.time, input.durationMinutes);
  const id = await withTransaction(async (c) => {
    await lockBranch(c, shopId);
    const tableIds = await placeTables(c, shopId, input.tableIds, input.partySize, start, end, null);
    const customerId = await customerFor(c, shopId, input, 'Added from a table booking');
    const { rows } = await c.query(
      `INSERT INTO reservations (shop_id, customer_id, name, phone, email, party_size, starts_at, ends_at, table_ids, source, notes, manage_token, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'staff', $10, $11, $12) RETURNING id`,
      [shopId, customerId, input.name, input.phone, input.email, input.partySize, start, end, tableIds, input.notes, newToken(), userId],
    );
    return Number(rows[0].id);
  });
  if (input.email) queueBookingMail('confirmed', shopId, id);
  return (await findReservation(pool, shopId, id))!;
}

/** Change a booking that is still to come or at the table. The guest is emailed if the time moved. */
export async function updateReservation(shopId: number, id: number, input: ReservationInput) {
  const { start, end } = span(input.date, input.time, input.durationMinutes);
  const before = await withTransaction(async (c) => {
    await lockBranch(c, shopId);
    const r = await findReservation(c, shopId, id);
    if (!r) throw notFound('Booking');
    if (r.status !== 'booked' && r.status !== 'seated') throw new AppError(409, 'BOOKING_CLOSED', `This booking is ${STATUS_WORD[r.status]} and can't be changed.`);
    const tableIds = await placeTables(c, shopId, input.tableIds, input.partySize, start, end, id);
    await c.query(
      `UPDATE reservations SET name = $3, phone = $4, email = $5, party_size = $6, starts_at = $7, ends_at = $8, table_ids = $9, notes = $10, updated_at = now()
       WHERE shop_id = $1 AND id = $2`,
      [shopId, id, input.name, input.phone, input.email, input.partySize, start, end, tableIds, input.notes],
    );
    return r;
  });
  if (input.email && before.status === 'booked' && new Date(before.startsAt).getTime() !== start.getTime()) queueBookingMail('updated', shopId, id);
  return (await findReservation(pool, shopId, id))!;
}

const STATUS_WORD: Record<ReservationStatus, string> = { booked: 'booked', seated: 'seated', finished: 'finished', cancelled: 'cancelled', no_show: 'marked as a no-show' };

/** What each status can move to. "booked" from "seated" undoes a seat tapped by mistake. */
const MOVES: Record<ReservationStatus, ReservationStatus[]> = {
  booked: ['seated', 'cancelled', 'no_show'],
  seated: ['finished', 'booked'],
  finished: [],
  cancelled: [],
  no_show: [],
};

const SET: Record<ReservationStatus, string> = {
  booked: `seated_at = NULL`,
  seated: `seated_at = now()`,
  // Leaving early frees the table for the rest of the slot.
  finished: `finished_at = now(), ends_at = GREATEST(LEAST(ends_at, now()), starts_at + interval '1 minute')`,
  cancelled: `cancelled_at = now()`,
  no_show: `cancelled_at = now()`,
};

export async function setStatus(shopId: number, id: number, status: ReservationStatus) {
  const r = await findReservation(pool, shopId, id);
  if (!r) throw notFound('Booking');
  if (!MOVES[r.status].includes(status)) {
    throw new AppError(409, 'BAD_STATUS', r.status === status ? `This booking is already ${STATUS_WORD[status]}.` : `This booking is ${STATUS_WORD[r.status]}, so it can't be ${STATUS_WORD[status]} now.`);
  }
  const { rowCount } = await pool.query(`UPDATE reservations SET status = $3, ${SET[status]}, updated_at = now() WHERE shop_id = $1 AND id = $2 AND status = $4`, [
    shopId,
    id,
    status,
    r.status,
  ]);
  if (!rowCount) throw new AppError(409, 'BOOKING_CHANGED', 'Someone else just changed this booking. Please refresh.');
  if (status === 'cancelled' && r.email) queueBookingMail('cancelled', shopId, id);
  return (await findReservation(pool, shopId, id))!;
}

// ---------------------------------------------------------------------------------------------
// Online booking
// ---------------------------------------------------------------------------------------------

/** Online, one table seats the whole party, so the largest table also caps the party size. */
export async function publicPage(s: ReservationSettings & { shopId: number }) {
  const shop = await findShop(pool, s.shopId);
  if (!shop) throw notFound('Booking page');
  const largest = Math.max(0, ...(await activeTables(pool, s.shopId)).map((t) => t.seats));
  return {
    shop: { name: shop.name, logoKey: shop.logoKey, phone: shop.phone },
    today: istDate(new Date()),
    maxParty: Math.min(s.maxParty, largest),
    daysAhead: s.daysAhead,
    closedDays: s.closedDays,
    opensAt: s.opensAt,
    closesAt: s.closesAt,
    durationMinutes: s.durationMinutes,
  };
}

export type NoTimesReason = 'closed' | 'out_of_range' | 'too_big' | 'full' | null;

/** The start times on one day, each with whether a table that seats the party is free then. */
export async function availableTimes(shopId: number, s: ReservationSettings, date: string, party: number, now = new Date()) {
  const none = (reason: NoTimesReason) => ({ times: [] as { time: string; available: boolean }[], reason });
  const today = istDate(now);
  if (date < today || date > addDays(today, s.daysAhead)) return none('out_of_range');
  if (s.closedDays.includes(weekday(date))) return none('closed');
  const tables = (await activeTables(pool, shopId)).filter((t) => t.seats >= party);
  if (party > s.maxParty || !tables.length) return none('too_big');

  const earliest = now.getTime() + s.minNoticeMinutes * 60_000;
  const dayHolds = await holds(pool, shopId, istInstant(date, s.opensAt), istInstant(date, s.closesAt), null);
  const times = [];
  for (let m = toMinutes(s.opensAt); m + s.durationMinutes <= toMinutes(s.closesAt); m += s.slotMinutes) {
    const time = fromMinutes(m);
    const { start, end } = span(date, time, s.durationMinutes);
    if (start.getTime() < earliest) continue;
    const overlapping = dayHolds.filter((h) => h.startsAt < end && h.endsAt > start);
    times.push({ time, available: !!pickTable(tables, overlapping, party) });
  }
  return { times, reason: (times.some((t) => t.available) ? null : 'full') as NoTimesReason };
}

/** At most this many upcoming online bookings per email, so one person can't hold every table. */
const MAX_UPCOMING = 3;

/**
 * Checks the emailed code and books the best free table in one go. If the time was taken
 * meanwhile, nothing is saved (the code stays usable for another time).
 */
export async function bookOnline(s: ReservationSettings & { shopId: number }, input: BookingConfirm) {
  const { times } = await availableTimes(s.shopId, s, input.date, input.partySize);
  if (!times.some((t) => t.time === input.time)) {
    throw new AppError(409, 'SLOT_TAKEN', "That time can't be booked any more. Please pick another time.");
  }
  const { start, end } = span(input.date, input.time, s.durationMinutes);
  const result = await withTransaction(async (c) => {
    const used = await useCode(c, s.shopId, input.challenge, input.code);
    if ('error' in used) return used;
    const { otp } = used;
    await lockBranch(c, s.shopId);

    const { rows: mine } = await c.query(
      `SELECT count(*)::int AS n, count(*) FILTER (WHERE starts_at < $4 AND ends_at > $3)::int AS clash FROM reservations
       WHERE shop_id = $1 AND lower(email) = $2 AND status = 'booked' AND ends_at > now()`,
      [s.shopId, otp.email.toLowerCase(), start, end],
    );
    if (mine[0].clash) throw new AppError(409, 'ALREADY_BOOKED', 'You already have a booking at this time. Check your email for it.');
    if (mine[0].n >= MAX_UPCOMING) throw new AppError(409, 'TOO_MANY_BOOKINGS', `You already have ${MAX_UPCOMING} upcoming bookings here. Please call us to book more.`);

    const tables = await activeTables(c, s.shopId);
    const table = pickTable(tables, await holds(c, s.shopId, start, end, null), input.partySize);
    if (!table) throw new AppError(409, 'SLOT_TAKEN', 'Sorry, that time was just taken. Please pick another time.');

    const customerId = await customerFor(c, s.shopId, otp, 'Added from an online table booking');
    const manageToken = newToken();
    const { rows } = await c.query(
      `INSERT INTO reservations (shop_id, customer_id, name, phone, email, party_size, starts_at, ends_at, table_ids, source, notes, manage_token)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'online', $10, $11) RETURNING id`,
      [s.shopId, customerId, otp.name, otp.phone, otp.email, input.partySize, start, end, [table.id], input.notes, manageToken],
    );
    return { id: Number(rows[0].id), manageToken };
  });
  if ('error' in result) throw result.error;
  queueBookingMail('confirmed', s.shopId, result.id);
  return { manageToken: result.manageToken };
}

/** The guest's own page for their booking. */
export async function guestView(token: string) {
  const r = await findByManageToken(pool, token);
  if (!r) throw notFound('Booking');
  return {
    shop: { name: r.shopName, logoKey: r.logoKey, phone: r.shopPhone },
    name: r.name,
    partySize: r.partySize,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    status: r.status,
    notes: r.notes,
    canCancel: r.status === 'booked' && new Date(r.startsAt).getTime() > Date.now(),
  };
}

export async function guestCancel(token: string) {
  const r = await findByManageToken(pool, token);
  if (!r) throw notFound('Booking');
  const { rowCount } = await pool.query(
    `UPDATE reservations SET status = 'cancelled', cancelled_at = now(), updated_at = now()
     WHERE id = $1 AND status = 'booked' AND starts_at > now()`,
    [r.id],
  );
  if (!rowCount) throw new AppError(409, 'CANT_CANCEL', r.status === 'cancelled' ? 'This booking is already cancelled.' : 'This booking can no longer be cancelled online. Please call us.');
  return guestView(token);
}
