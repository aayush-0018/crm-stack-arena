import { env } from '../../config/env';
import { pool } from '../../db/pool';
import { sendMail } from '../../lib/mailer';
import { clock, dayLabel } from './reservations.repo';

export type BookingMail = 'confirmed' | 'updated' | 'cancelled';

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The guest's page for their booking: see it, or cancel it. */
export const bookingUrl = (manageToken: string) => `${env.APP_URL.replace(/\/+$/, '')}/b/${manageToken}`;

const HEADLINE: Record<BookingMail, (shop: string) => string> = {
  confirmed: (shop) => `Your table at ${shop} is booked`,
  updated: (shop) => `Your booking at ${shop} has changed`,
  cancelled: (shop) => `Your booking at ${shop} is cancelled`,
};

export async function sendBookingMail(kind: BookingMail, shopId: number, id: number) {
  const { rows } = await pool.query(
    `SELECT r.name, r.email, r.party_size AS "partySize", r.starts_at AS "startsAt", r.manage_token AS "manageToken",
       s.name AS "shopName", s.phone AS "shopPhone"
     FROM reservations r JOIN shops s ON s.id = r.shop_id WHERE r.shop_id = $1 AND r.id = $2 AND r.email IS NOT NULL`,
    [shopId, id],
  );
  const r = rows[0];
  if (!r) return;
  const first = String(r.name).split(' ')[0];
  const when = `${dayLabel(r.startsAt)} at ${clock(r.startsAt)}`;
  const people = `${r.partySize} ${r.partySize === 1 ? 'person' : 'people'}`;
  const link = bookingUrl(r.manageToken);
  const call = r.shopPhone ? `Questions? Call ${r.shopName} on ${r.shopPhone}.` : null;
  const lead =
    kind === 'cancelled'
      ? `Your booking for ${people} on ${when} has been cancelled. We hope to see you another time.`
      : kind === 'updated'
        ? `Your booking has moved. It is now for ${people} on ${when}.`
        : `We've saved a table for ${people} on ${when}.`;

  await sendMail({
    to: r.email,
    subject: `${HEADLINE[kind](r.shopName)} — ${when}`,
    text: [`Hi ${first},`, '', lead, ...(kind === 'cancelled' ? [] : ['', `See or cancel your booking: ${link}`]), ...(call ? ['', call] : [])].join('\n'),
    html: `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;color:#171717;line-height:1.5;max-width:480px">
  <p>Hi ${escape(first)},</p>
  <p>${escape(lead)}</p>
  ${
    kind === 'cancelled'
      ? ''
      : `<p style="margin:24px 0"><a href="${escape(link)}" style="background:#171717;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;display:inline-block">See or cancel booking</a></p>`
  }
  ${call ? `<p style="color:#5f5f5b;font-size:14px">${escape(call)}</p>` : ''}
  <p style="color:#8f8f8a;font-size:12px">Sent by ${escape(r.shopName)} using CartWell.</p>
</div>`,
  });
}

const inFlight = new Set<Promise<void>>();

/** Emails in the background: a slow mail provider never holds up the booking. Failures are logged. */
export function queueBookingMail(kind: BookingMail, shopId: number, id: number) {
  const p = sendBookingMail(kind, shopId, id)
    .catch((err) => console.error(`Could not email booking ${id}:`, err instanceof Error ? err.message : err))
    .finally(() => inFlight.delete(p));
  inFlight.add(p);
}

/** Tests wait for these before checking emails or closing the database. */
export const bookingMailsSettled = () => Promise.all([...inFlight]);
