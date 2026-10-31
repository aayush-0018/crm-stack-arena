import { Db } from '../../db/pool';

/** India has one time zone and no daylight saving, so bookings are worked out at +05:30. */
const IST = '+05:30';

/** '2026-10-31' + '19:30' -> that moment in India. */
export const istInstant = (date: string, time: string) => new Date(`${date}T${time}:00${IST}`);
/** A moment -> its date in India, 'YYYY-MM-DD'. */
export const istDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
/** 'YYYY-MM-DD' -> 0 = Sunday … 6 = Saturday. */
export const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
export const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** 'HH:MM' -> minutes after midnight, and back. */
export const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
export const fromMinutes = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export interface ReservationSettings {
  bookingToken: string | null;
  opensAt: string;
  closesAt: string;
  closedDays: number[];
  slotMinutes: number;
  durationMinutes: number;
  maxParty: number;
  daysAhead: number;
  minNoticeMinutes: number;
}

const DEFAULTS: ReservationSettings = {
  bookingToken: null,
  opensAt: '11:00',
  closesAt: '23:00',
  closedDays: [],
  slotMinutes: 30,
  durationMinutes: 90,
  maxParty: 8,
  daysAhead: 30,
  minNoticeMinutes: 60,
};

const SETTINGS_COLS = `shop_id AS "shopId", booking_token AS "bookingToken", to_char(opens_at, 'HH24:MI') AS "opensAt",
  to_char(closes_at, 'HH24:MI') AS "closesAt", closed_days AS "closedDays", slot_minutes AS "slotMinutes",
  duration_minutes AS "durationMinutes", max_party AS "maxParty", days_ahead AS "daysAhead", min_notice_minutes AS "minNoticeMinutes"`;

/** The branch's booking rules; the defaults until an owner saves them. */
export async function getSettings(db: Db, shopId: number): Promise<ReservationSettings> {
  const { rows } = await db.query(`SELECT ${SETTINGS_COLS} FROM reservation_settings WHERE shop_id = $1`, [shopId]);
  if (!rows[0]) return { ...DEFAULTS };
  const { shopId: _, ...s } = rows[0];
  return s;
}

export async function findSettingsByToken(db: Db, token: string): Promise<(ReservationSettings & { shopId: number }) | null> {
  const { rows } = await db.query(`SELECT ${SETTINGS_COLS} FROM reservation_settings WHERE booking_token = $1`, [token]);
  return rows[0] ? { ...rows[0], shopId: Number(rows[0].shopId) } : null;
}

export async function saveSettings(db: Db, shopId: number, s: Omit<ReservationSettings, 'bookingToken'>) {
  await db.query(
    `INSERT INTO reservation_settings (shop_id, opens_at, closes_at, closed_days, slot_minutes, duration_minutes, max_party, days_ahead, min_notice_minutes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (shop_id) DO UPDATE SET opens_at = $2, closes_at = $3, closed_days = $4, slot_minutes = $5, duration_minutes = $6,
       max_party = $7, days_ahead = $8, min_notice_minutes = $9, updated_at = now()`,
    [shopId, s.opensAt, s.closesAt, s.closedDays, s.slotMinutes, s.durationMinutes, s.maxParty, s.daysAhead, s.minNoticeMinutes],
  );
  return getSettings(db, shopId);
}

export async function setBookingToken(db: Db, shopId: number, token: string | null) {
  await db.query(
    `INSERT INTO reservation_settings (shop_id, booking_token) VALUES ($1, $2)
     ON CONFLICT (shop_id) DO UPDATE SET booking_token = $2, updated_at = now()`,
    [shopId, token],
  );
  return getSettings(db, shopId);
}

// ---------------------------------------------------------------------------------------------
// Bookings
// ---------------------------------------------------------------------------------------------

export const RESERVATION_STATUSES = ['booked', 'seated', 'finished', 'cancelled', 'no_show'] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];
/** These hold their tables. */
export const HOLDING = `('booked', 'seated')`;

export interface Reservation {
  id: number;
  customerId: number | null;
  name: string;
  phone: string;
  email: string | null;
  partySize: number;
  startsAt: string;
  endsAt: string;
  tableIds: number[];
  tables: { id: number; label: string }[];
  status: ReservationStatus;
  source: 'staff' | 'online';
  notes: string | null;
  seatedAt: string | null;
  createdAt: string;
}

const COLS = `r.id, r.customer_id AS "customerId", r.name, r.phone, r.email, r.party_size AS "partySize",
  r.starts_at AS "startsAt", r.ends_at AS "endsAt", r.table_ids AS "tableIds", r.status, r.source, r.notes,
  r.seated_at AS "seatedAt", r.created_at AS "createdAt",
  COALESCE((SELECT json_agg(json_build_object('id', t.id, 'label', t.label) ORDER BY t.label)
            FROM dining_tables t WHERE t.id = ANY(r.table_ids)), '[]') AS tables`;

const shape = (r: Reservation & { tableIds: (string | number)[] }): Reservation => ({
  ...r,
  id: Number(r.id),
  customerId: r.customerId === null ? null : Number(r.customerId),
  tableIds: r.tableIds.map(Number),
});

/** Every booking that starts on this day (India), in time order. */
export async function listDay(db: Db, shopId: number, date: string): Promise<Reservation[]> {
  const { rows } = await db.query(
    `SELECT ${COLS} FROM reservations r
     WHERE r.shop_id = $1 AND r.starts_at >= $2 AND r.starts_at < $3
     ORDER BY r.starts_at, r.id
     LIMIT 500`,
    [shopId, istInstant(date, '00:00'), istInstant(addDays(date, 1), '00:00')],
  );
  return rows.map(shape);
}

export async function findReservation(db: Db, shopId: number, id: number): Promise<Reservation | null> {
  const { rows } = await db.query(`SELECT ${COLS} FROM reservations r WHERE r.shop_id = $1 AND r.id = $2`, [shopId, id]);
  return rows[0] ? shape(rows[0]) : null;
}

export async function findByManageToken(db: Db, token: string) {
  const { rows } = await db.query(
    `SELECT ${COLS}, r.shop_id AS "shopId", s.name AS "shopName", s.logo_key AS "logoKey", s.phone AS "shopPhone"
     FROM reservations r JOIN shops s ON s.id = r.shop_id WHERE r.manage_token = $1`,
    [token],
  );
  return rows[0] ? { ...shape(rows[0]), shopId: Number(rows[0].shopId), shopName: rows[0].shopName as string, logoKey: rows[0].logoKey as string | null, shopPhone: rows[0].shopPhone as string | null } : null;
}

/**
 * For the live floor: bookings starting in the next two hours (or late by up to an hour), and
 * parties seated today that haven't left yet.
 */
export async function forLiveFloor(db: Db, shopId: number): Promise<Reservation[]> {
  const { rows } = await db.query(
    `SELECT ${COLS} FROM reservations r
     WHERE r.shop_id = $1 AND (
       (r.status = 'booked' AND r.starts_at BETWEEN now() - interval '1 hour' AND now() + interval '2 hours')
       OR (r.status = 'seated' AND r.starts_at > now() - interval '12 hours'))
     ORDER BY r.starts_at, r.id`,
    [shopId],
  );
  return rows.map(shape);
}

const clockFmt = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true });
const dayFmt = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
/** '7:30 pm' */
export const clock = (d: Date | string) => clockFmt.format(new Date(d));
/** 'Sat, 31 Oct 2026' */
export const dayLabel = (d: Date | string) => dayFmt.format(new Date(d));
