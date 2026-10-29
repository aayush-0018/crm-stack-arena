import bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { env } from '../../config/env';
import { withTransaction } from '../../db/tx';
import { pool } from '../../db/pool';
import { AppError } from '../../lib/errors';
import { sendMail } from '../../lib/mailer';
import { forgetSessionCache } from '../../middleware/auth';
import { openLastBranch } from './auth.service';

const TOKEN_MINUTES = 30;
const BCRYPT_COST = 12;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

// Simple in-memory throttles (one Render instance, so memory is enough).
const hits = new Map<string, number[]>();
function tooMany(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > max;
}
const HOUR = 60 * 60 * 1000;

const maskEmail = (email: string) => {
  const [name, domain] = email.split('@');
  return `${name.slice(0, 2)}${'*'.repeat(Math.max(1, name.length - 2))}@${domain}`;
};

/**
 * Always resolves the same way whether or not the email has an account, so the response
 * can't be used to discover who is registered.
 */
export async function requestReset(email: string, ip: string) {
  if (tooMany(`ip:${ip}`, 10, HOUR)) {
    throw new AppError(429, 'RATE_LIMITED', 'Too many requests. Please try again in a while.');
  }
  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.email, s.name AS "shopName"
     FROM users u LEFT JOIN shops s ON s.id = u.shop_id WHERE lower(u.email) = $1`,
    [email],
  );
  const user = rows[0];
  if (!user || tooMany(`email:${email}`, 3, HOUR)) return;

  const token = randomBytes(32).toString('base64url');
  await withTransaction(async (c) => {
    // Only the newest link works.
    await c.query(`UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, [user.id]);
    await c.query(
      `INSERT INTO password_resets (user_id, token_hash, expires_at, requested_ip)
       VALUES ($1, $2, now() + make_interval(mins => $3), $4)`,
      [user.id, sha256(token), TOKEN_MINUTES, ip],
    );
  });

  const link = `${env.APP_URL.replace(/\/+$/, '')}/reset-password?token=${token}`;
  try {
    await sendMail({ ...resetEmail(user.name, user.shopName, link), to: user.email });
  } catch (err) {
    // Don't reveal delivery problems to the requester; make them obvious in the server log.
    console.error('Password reset email failed:', err);
  }
}

/** Lets the reset page say "link expired" up front, and whose password it is for. */
export async function checkResetToken(token: string) {
  const { rows } = await pool.query(
    `SELECT u.email FROM password_resets r JOIN users u ON u.id = r.user_id
     WHERE r.token_hash = $1 AND r.used_at IS NULL AND r.expires_at > now()`,
    [sha256(token)],
  );
  return rows[0] ? { valid: true as const, email: maskEmail(rows[0].email) } : { valid: false as const };
}

export async function resetPassword(token: string, password: string) {
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  const user = await withTransaction(async (c) => {
    const { rows } = await c.query(
      `SELECT r.id, r.user_id AS "userId", u.shop_id AS "lastShopId"
       FROM password_resets r JOIN users u ON u.id = r.user_id
       WHERE r.token_hash = $1 AND r.used_at IS NULL AND r.expires_at > now()
       FOR UPDATE OF r`,
      [sha256(token)],
    );
    const r = rows[0];
    if (!r) throw new AppError(400, 'INVALID_TOKEN', 'This reset link is invalid or has expired. Please request a new one.');
    await c.query(`UPDATE users SET password_hash = $2, password_changed_at = now(), updated_at = now() WHERE id = $1`, [
      r.userId,
      passwordHash,
    ]);
    await c.query(`UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, [r.userId]);
    return r;
  });
  forgetSessionCache(user.userId); // sign out other devices right away
  return openLastBranch(user.userId, user.lastShopId);
}

function resetEmail(name: string, shopName: string | null, link: string) {
  const first = name.split(' ')[0];
  const app = shopName ? `${shopName} on CartWell` : 'CartWell';
  const text = [
    `Hi ${first},`,
    '',
    `We got a request to reset the password for ${app}.`,
    `Open this link to choose a new one. It works once and expires in ${TOKEN_MINUTES} minutes:`,
    '',
    link,
    '',
    "If you didn't ask for this, ignore this email — your password won't change.",
  ].join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#f4f4f2;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#171717">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #ebebe8;border-radius:14px">
      <tr><td style="padding:28px 28px 8px;font-size:18px;font-weight:600">Reset your password</td></tr>
      <tr><td style="padding:4px 28px 0;font-size:14px;line-height:1.6;color:#5f5f5b">
        Hi ${escapeHtml(first)}, we got a request to reset the password for ${escapeHtml(app)}.
        This link works once and expires in ${TOKEN_MINUTES} minutes.
      </td></tr>
      <tr><td style="padding:22px 28px"><a href="${link}" style="display:inline-block;background:#171717;color:#ffffff;text-decoration:none;font-size:14px;font-weight:500;padding:11px 18px;border-radius:9px">Choose a new password</a></td></tr>
      <tr><td style="padding:0 28px 24px;font-size:12px;line-height:1.6;color:#8f8f8a">
        If the button doesn't work, paste this into your browser:<br><span style="word-break:break-all;color:#5f5f5b">${link}</span><br><br>
        If you didn't ask for this, ignore this email — your password won't change.
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
  return { to: '', subject: `Reset your ${shopName ?? 'CartWell'} password`, html, text } as const;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
