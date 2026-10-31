import type { Reservation, ReservationStatus } from '../../types';
import type { Tone } from '../ui/Badge';

export const STATUS_LABEL: Record<ReservationStatus, string> = { booked: 'Booked', seated: 'Seated', finished: 'Finished', cancelled: 'Cancelled', no_show: 'No-show' };
export const STATUS_TONE: Record<ReservationStatus, Tone> = { booked: 'blue', seated: 'green', finished: 'gray', cancelled: 'gray', no_show: 'red' };

export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DAY_LONG = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];

/** Bookings that hold their tables. */
export const holdsTable = (r: Reservation) => r.status === 'booked' || r.status === 'seated';

const tz = 'Asia/Kolkata';
const clockFmt = new Intl.DateTimeFormat('en-IN', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true });
const hhmmFmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz });
const dayFmt = new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
const longDayFmt = new Intl.DateTimeFormat('en-IN', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

/** ISO time -> '7:30 pm' (India). */
export const clock = (iso: string) => clockFmt.format(new Date(iso));
/** ISO time -> '19:30' (India). */
export const hhmm = (iso: string) => hhmmFmt.format(new Date(iso));
/** ISO time -> 'YYYY-MM-DD' (India). */
export const dateOf = (iso: string | number) => dateFmt.format(new Date(iso));
/** ISO time -> 'Saturday, 31 October 2026' (India). */
export const longDay = (iso: string) => longDayFmt.format(new Date(iso));
/** '19:30' -> '7:30 pm' */
export const timeLabel = (t: string) => clockFmt.format(new Date(`2000-01-01T${t}:00+05:30`));
/** '19:30' -> minutes after midnight. */
export const minutesOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
/** 'YYYY-MM-DD' -> 'Today' / 'Tomorrow' / 'Sat, 31 Oct'. */
export function dayTitle(date: string, today: string) {
  if (date === today) return 'Today';
  if (date === addDays(today, 1)) return 'Tomorrow';
  if (date === addDays(today, -1)) return 'Yesterday';
  return dayFmt.format(new Date(`${date}T00:00:00Z`));
}

/** '1 h 30 min' */
export function durationLabel(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return [h ? `${h} h` : '', m ? `${m} min` : ''].filter(Boolean).join(' ');
}

export const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;

/** India's time zone in the ISO strings the server gets. */
export const toInstant = (date: string, time: string) => new Date(`${date}T${time}:00+05:30`);
