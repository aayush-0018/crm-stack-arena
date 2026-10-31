import { createHash, randomInt } from 'crypto';
import { Db, pool } from '../../db/pool';
import { withTransaction } from '../../db/tx';
import { AppError, notFound } from '../../lib/errors';
import { sendMail } from '../../lib/mailer';
import { createLimiter } from '../../lib/throttle';
import { findActiveByPhone } from '../customers/customers.repo';
import { createCustomer } from '../customers/customers.service';
import { createOrder } from '../orders/orders.service';
import { computeTotals } from '../orders/totals';
import { newToken } from './dinein.service';

/** Off a guest's first ever order at this branch (decided when they verify their email). */
export const FIRST_ORDER_DISCOUNT_PCT = 15;
const CODE_TTL_MIN = 10;
const MAX_TRIES = 5;
const SESSION_HOURS = 12;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const codeHash = (challenge: string, code: string) => sha256(`${challenge}:${code}`);

export async function findTableByToken(db: Db, token: string) {
  const { rows } = await db.query(
    `SELECT t.id, t.shop_id AS "shopId", t.label, f.name AS "floorName"
     FROM dining_tables t LEFT JOIN floors f ON f.id = t.floor_id
     WHERE t.qr_token = $1 AND t.active`,
    [token],
  );
  return (rows[0] as { id: number; shopId: number; label: string; floorName: string | null } | undefined) ?? null;
}

async function tableOr404(token: string) {
  const table = await findTableByToken(pool, token);
  if (!table) throw notFound('Table');
  return table;
}

const maskEmail = (e: string) => e.replace(/^(.)(.*)(@.*)$/, (_, a: string, mid: string, dom: string) => `${a}${'•'.repeat(Math.min(6, Math.max(1, mid.length)))}${dom}`);

// ---------------------------------------------------------------------------------------------
// One-time code by email
// ---------------------------------------------------------------------------------------------

const codesByIp = createLimiter(10, 10 * 60_000);

/** Emails a 6-digit code. Limits: one per email every 30 seconds, five per 10 minutes; ten per address. */
export async function requestCode(tableToken: string, g: { name: string; phone: string; email: string }, ip: string) {
  const table = await tableOr404(tableToken);
  const wait = codesByIp.retryAfter(ip);
  const { rows: recent } = await pool.query(
    `SELECT count(*)::int AS n, max(created_at) AS last FROM guest_otps
     WHERE shop_id = $1 AND lower(email) = $2 AND created_at > now() - interval '10 minutes'`,
    [table.shopId, g.email],
  );
  const sinceLast = recent[0].last ? Date.now() - new Date(recent[0].last).getTime() : Infinity;
  if (wait > 0 || recent[0].n >= 5) {
    throw new AppError(429, 'TOO_MANY_CODES', 'Too many codes asked for. Please wait a few minutes, or ask the staff for help.');
  }
  if (sinceLast < 30_000) {
    throw new AppError(429, 'CODE_JUST_SENT', `A code was just sent. You can ask for another in ${Math.ceil((30_000 - sinceLast) / 1000)} seconds.`);
  }
  codesByIp.hit(ip);

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const challenge = newToken();
  await pool.query(
    `INSERT INTO guest_otps (shop_id, challenge, name, phone, email, code_hash, expires_at, ip)
     VALUES ($1, $2, $3, $4, $5, $6, now() + interval '${CODE_TTL_MIN} minutes', $7)`,
    [table.shopId, challenge, g.name, g.phone, g.email, codeHash(challenge, code), ip],
  );
  const { rows: shop } = await pool.query(`SELECT name FROM shops WHERE id = $1`, [table.shopId]);
  const shopName = shop[0]?.name ?? 'the café';
  try {
    await sendMail({
      to: g.email,
      subject: `${code} is your code for ${shopName}`,
      text: `Hi ${g.name.split(' ')[0]},\n\nYour code to see the menu and order at ${shopName} is ${code}.\nIt works for ${CODE_TTL_MIN} minutes.\n\nIf you didn't ask for this, ignore this email.`,
      html: `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;color:#171717;line-height:1.5">
  <p>Hi ${g.name.split(' ')[0].replace(/[&<>"']/g, '')},</p>
  <p>Your code to see the menu and order at <strong>${shopName.replace(/[&<>"']/g, '')}</strong> is</p>
  <p style="font-size:32px;font-weight:700;letter-spacing:8px;margin:16px 0">${code}</p>
  <p style="color:#8f8f8a;font-size:13px">It works for ${CODE_TTL_MIN} minutes. If you didn't ask for this, ignore this email.</p>
</div>`,
    });
  } catch (err) {
    console.error('Could not send a guest code:', err instanceof Error ? err.message : err);
    throw new AppError(503, 'MAIL_FAILED', "We couldn't send the email just now. Please check the address or ask the staff for help.");
  }
  return { challenge, sentTo: maskEmail(g.email), expiresInMinutes: CODE_TTL_MIN };
}

/**
 * Checks the code. On success the guest is linked to the branch's customer with that mobile number
 * (created if new) and gets a session token. First-time guests are offered the first-order discount.
 */
export async function verifyCode(tableToken: string, challenge: string, code: string) {
  const table = await tableOr404(tableToken);
  const result = await withTransaction(async (c) => {
    const { rows } = await c.query(
      `SELECT id, name, phone, email, code_hash AS "codeHash", attempts, used_at AS "usedAt", expires_at < now() AS expired
       FROM guest_otps WHERE challenge = $1 AND shop_id = $2 FOR UPDATE`,
      [challenge, table.shopId],
    );
    const otp = rows[0];
    if (!otp || otp.usedAt || otp.expired || otp.attempts >= MAX_TRIES) {
      return { error: new AppError(400, 'CODE_EXPIRED', 'This code has expired. Please ask for a new one.', { code: 'This code has expired' }) };
    }
    if (otp.codeHash !== codeHash(challenge, code)) {
      await c.query(`UPDATE guest_otps SET attempts = attempts + 1 WHERE id = $1`, [otp.id]);
      const left = MAX_TRIES - otp.attempts - 1;
      return {
        error: new AppError(400, 'WRONG_CODE', left > 0 ? `That code isn't right. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Too many wrong codes. Please ask for a new one.', {
          code: "That code isn't right",
        }),
      };
    }
    await c.query(`UPDATE guest_otps SET used_at = now() WHERE id = $1`, [otp.id]);

    // An existing customer keeps their saved name and email; the verified email is kept on the session.
    const existing = await findActiveByPhone(c, table.shopId, otp.phone);
    const customerId: number = existing
      ? Number(existing)
      : (await createCustomer(c, table.shopId, { name: otp.name, phone: otp.phone, email: otp.email, address: null, notes: 'Added when ordering from a table QR code' })).id;

    // First time = no order (other than cancelled) under this mobile number or this email.
    const { rows: before } = await c.query(
      `SELECT EXISTS (
         SELECT 1 FROM orders o LEFT JOIN customers cu ON cu.id = o.customer_id
         WHERE o.shop_id = $1 AND o.status <> 'cancelled' AND (o.customer_id = $2 OR lower(cu.email) = $3)
       ) AS ordered`,
      [table.shopId, customerId, otp.email.toLowerCase()],
    );
    const pct = before[0].ordered ? 0 : FIRST_ORDER_DISCOUNT_PCT;
    const token = newToken() + newToken();
    await c.query(
      `INSERT INTO guest_sessions (shop_id, customer_id, token_hash, name, phone, email, first_order_pct, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now() + interval '${SESSION_HOURS} hours')`,
      [table.shopId, customerId, sha256(token), otp.name, otp.phone, otp.email, pct],
    );
    return { token, guest: { name: otp.name as string, phone: otp.phone as string, email: otp.email as string }, discountPct: pct };
  });
  if ('error' in result) throw result.error;
  return { sessionToken: result.token, guest: result.guest, discountPct: result.discountPct };
}

// ---------------------------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------------------------

export interface GuestSession {
  id: number;
  shopId: number;
  customerId: number;
  name: string;
  phone: string;
  email: string;
  firstOrderPct: number;
  discountClaimed: boolean;
}

export async function findSession(db: Db, shopId: number, token: string | undefined): Promise<GuestSession | null> {
  if (!token || !/^[A-Za-z0-9_-]{40,128}$/.test(token)) return null;
  const { rows } = await db.query(
    `SELECT id, shop_id AS "shopId", customer_id AS "customerId", name, phone, email,
       first_order_pct AS "firstOrderPct", discount_claimed_at IS NOT NULL AS "discountClaimed"
     FROM guest_sessions WHERE token_hash = $1 AND shop_id = $2 AND expires_at > now()`,
    [sha256(token), shopId],
  );
  return rows[0] ?? null;
}

const sessionNeeded = () => new AppError(401, 'GUEST_SESSION', 'Please confirm your email again to order.');

/** The first-order discount still on offer for this session: not yet used, and still no orders. */
async function discountOnOffer(db: Db, s: GuestSession): Promise<number> {
  if (!s.firstOrderPct || s.discountClaimed) return 0;
  const { rows } = await db.query(`SELECT 1 FROM orders WHERE shop_id = $1 AND customer_id = $2 AND status <> 'cancelled' LIMIT 1`, [
    s.shopId,
    s.customerId,
  ]);
  return rows.length ? 0 : s.firstOrderPct;
}

/** The menu screen: shop and table always; the guest and products only once their email is verified. */
export async function tableMenu(tableToken: string, sessionToken: string | undefined) {
  const table = await tableOr404(tableToken);
  const session = await findSession(pool, table.shopId, sessionToken);
  return { table, session, discountPct: session ? await discountOnOffer(pool, session) : 0 };
}

// ---------------------------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------------------------

/** Half-up, in paise. */
export const discountFor = (subtotalPaise: number, pct: number) => Math.round((subtotalPaise * pct) / 100);

export async function placeGuestOrder(
  tableToken: string,
  sessionToken: string | undefined,
  input: { items: { productId: number; quantity: number }[]; note: string | null; paid: boolean; idempotencyKey: string },
) {
  const table = await tableOr404(tableToken);
  const session = await findSession(pool, table.shopId, sessionToken);
  if (!session) throw sessionNeeded();

  // Same item twice -> one line.
  const qty = new Map<number, number>();
  for (const it of input.items) qty.set(it.productId, (qty.get(it.productId) ?? 0) + it.quantity);
  const { rows: products } = await pool.query(
    `SELECT id, name, price_paise AS "pricePaise" FROM products WHERE shop_id = $1 AND active AND id = ANY($2::bigint[])`,
    [table.shopId, [...qty.keys()]],
  );
  if (products.length !== qty.size) {
    throw new AppError(409, 'ITEM_UNAVAILABLE', 'Some items in your order are no longer on the menu. Please refresh and try again.');
  }
  const items = products.map((p: { id: number; name: string; pricePaise: number }) => ({
    itemName: p.name,
    quantity: qty.get(Number(p.id))! * 1000,
    unitPrice: Number(p.pricePaise),
    productId: Number(p.id),
  }));
  const subtotal = computeTotals(items, 0, 0).subtotalPaise;

  // Claim the first-order discount for this one order (two quick orders can't both get it).
  let pct = await discountOnOffer(pool, session);
  if (pct) {
    const { rowCount } = await pool.query(`UPDATE guest_sessions SET discount_claimed_at = now() WHERE id = $1 AND discount_claimed_at IS NULL`, [session.id]);
    if (!rowCount) pct = 0;
  }
  const discount = discountFor(subtotal, pct);
  const unclaim = () => pct && pool.query(`UPDATE guest_sessions SET discount_claimed_at = NULL WHERE id = $1`, [session.id]);

  const guestToken = newToken();
  let result;
  try {
    result = await createOrder(
      table.shopId,
      null,
      {
        customerId: session.customerId,
        items,
        discount,
        notes: input.note,
        amountPaid: input.paid ? subtotal - discount : 0,
        paymentMethod: 'upi',
        idempotencyKey: input.idempotencyKey,
      },
      { tableId: table.id, tableLabel: table.label, guestName: session.name, guestToken, guestSessionId: session.id },
    );
  } catch (err) {
    await unclaim();
    throw err;
  }
  // A retried submission returns the order placed the first time (with its own token).
  if (!result.created) {
    await unclaim();
    const { rows } = await pool.query(`SELECT guest_token AS t FROM orders WHERE id = $1`, [result.order.id]);
    return { guestToken: rows[0].t as string, discountPaise: result.order.discountPaise };
  }
  return { guestToken, discountPaise: discount };
}

const GUEST_ORDER_COLS = `o.order_number AS "orderNumber", o.table_label AS "tableLabel", o.guest_name AS "guestName", o.notes,
  o.status, o.kitchen_status AS "kitchenStatus", o.created_at AS "createdAt", o.subtotal_paise AS "subtotalPaise",
  o.discount_paise AS "discountPaise", o.total_paise AS "totalPaise", o.amount_paid_paise AS "amountPaidPaise",
  o.payment_status AS "paymentStatus", o.guest_token AS "guestToken",
  COALESCE((SELECT json_agg(json_build_object('itemName', oi.item_name, 'quantity', oi.quantity, 'unitPricePaise', oi.unit_price_paise,
            'lineTotalPaise', oi.line_total_paise) ORDER BY oi.position) FROM order_items oi WHERE oi.order_id = o.id), '[]') AS items`;

/** This guest's orders from the last 12 hours (any table here), newest first. They can't be changed. */
export async function myOrders(tableToken: string, sessionToken: string | undefined) {
  const table = await tableOr404(tableToken);
  const session = await findSession(pool, table.shopId, sessionToken);
  if (!session) throw sessionNeeded();
  const { rows } = await pool.query(
    `SELECT ${GUEST_ORDER_COLS} FROM orders o
     WHERE o.shop_id = $1 AND o.customer_id = $2 AND o.source = 'table' AND o.created_at > now() - interval '${SESSION_HOURS} hours'
     ORDER BY o.created_at DESC, o.id DESC LIMIT 30`,
    [table.shopId, session.customerId],
  );
  return rows;
}

/** One order, for whoever holds its guest link: progress, items, payment and the bill once sent. */
export async function guestOrderView(guestToken: string) {
  const { rows } = await pool.query(
    `SELECT ${GUEST_ORDER_COLS}, s.name AS "shopName", s.logo_key AS "logoKey", t.qr_token AS "tableToken"
     FROM orders o JOIN shops s ON s.id = o.shop_id LEFT JOIN dining_tables t ON t.id = o.table_id AND t.active
     WHERE o.guest_token = $1`,
    [guestToken],
  );
  if (!rows[0]) throw notFound('Order');
  return rows[0];
}
