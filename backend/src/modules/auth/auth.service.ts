import bcrypt from 'bcrypt';
import { z } from 'zod';
import { pool } from '../../db/pool';
import { withTransaction } from '../../db/tx';
import { AppError } from '../../lib/errors';
import { createLimiter } from '../../lib/throttle';
import { signToken } from '../../middleware/auth';
import { findShop } from '../shop/shop.repo';
import { loginSchema, registerSchema } from './auth.schemas';

const BCRYPT_COST = 12;
const USER_COLS = `id, shop_id AS "shopId", name, email, role`;

/** The user as seen inside one branch: role comes from that branch's membership. */
async function userInBranch(userId: number, shopId: number) {
  const { rows } = await pool.query(
    `SELECT u.id, m.shop_id AS "shopId", u.name, u.email, m.role
     FROM users u JOIN shop_members m ON m.user_id = u.id
     WHERE u.id = $1 AND m.shop_id = $2`,
    [userId, shopId],
  );
  return rows[0] ?? null;
}

export async function register(input: z.infer<typeof registerSchema>) {
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);

  const user = await withTransaction(async (c) => {
    const exists = await c.query(`SELECT 1 FROM users WHERE lower(email) = $1`, [input.email]);
    if (exists.rowCount) {
      throw new AppError(409, 'EMAIL_EXISTS', 'An account with this email already exists', {
        email: 'An account with this email already exists',
      });
    }
    const shop = await c.query(`INSERT INTO shops (name) VALUES ($1) RETURNING id`, [input.shopName]);
    const shopId: number = shop.rows[0].id;
    await c.query(`INSERT INTO shop_counters (shop_id) VALUES ($1)`, [shopId]);
    const u = await c.query(
      `INSERT INTO users (shop_id, name, email, password_hash, role)
       VALUES ($1, $2, $3, $4, 'owner') RETURNING ${USER_COLS}`,
      [shopId, input.name, input.email, passwordHash],
    );
    await c.query(`INSERT INTO shop_members (user_id, shop_id, role) VALUES ($1, $2, 'owner')`, [u.rows[0].id, shopId]);
    return u.rows[0];
  });

  return session(user);
}

// Failed logins only: 5 per account and 20 per IP address in 15 minutes, then wait.
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const failedByEmail = createLimiter(5, LOGIN_WINDOW_MS);
const failedByIp = createLimiter(20, LOGIN_WINDOW_MS);

export async function login(input: z.infer<typeof loginSchema>, ip = 'unknown') {
  const wait = Math.max(failedByEmail.retryAfter(input.email), failedByIp.retryAfter(ip));
  if (wait > 0) {
    const mins = Math.ceil(wait / 60_000);
    throw new AppError(429, 'RATE_LIMITED', `Too many failed attempts. Please try again in ${mins} minute${mins === 1 ? '' : 's'}, or reset your password.`);
  }
  const { rows } = await pool.query(
    `SELECT ${USER_COLS}, password_hash AS "passwordHash" FROM users WHERE lower(email) = $1`,
    [input.email],
  );
  const row = rows[0];
  const ok = row ? await bcrypt.compare(input.password, row.passwordHash) : false;
  if (!ok) {
    failedByEmail.hit(input.email);
    failedByIp.hit(ip);
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }
  failedByEmail.reset(input.email);
  return openLastBranch(row.id, row.shopId);
}

/** Signs the user into the branch they used last, or their first branch if that's gone. */
export async function openLastBranch(userId: number, lastShopId: number | null) {
  const branch = await pool.query(
    `SELECT shop_id FROM shop_members WHERE user_id = $1 ORDER BY (shop_id = $2) DESC NULLS LAST, created_at LIMIT 1`,
    [userId, lastShopId],
  );
  if (!branch.rows[0]) throw new AppError(403, 'NO_BRANCH', 'This account has no branch to open');
  return session({ id: userId, shopId: branch.rows[0].shop_id });
}

/** Re-issues the session for another branch the user belongs to. */
export async function switchBranch(userId: number, shopId: number) {
  const user = await userInBranch(userId, shopId);
  if (!user) throw new AppError(404, 'NOT_FOUND', 'Branch not found');
  await pool.query(`UPDATE users SET shop_id = $2, updated_at = now() WHERE id = $1`, [userId, shopId]);
  return session(user);
}

export async function me(userId: number, shopId: number) {
  // Checks membership, not users.shop_id, so two tabs on different branches both stay signed in.
  const user = await userInBranch(userId, shopId);
  if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'Please log in');
  return { user, shop: await findShop(pool, shopId) };
}

async function session(u: { id: number; shopId: number }) {
  const user = await userInBranch(u.id, u.shopId);
  if (!user) throw new AppError(403, 'NO_BRANCH', 'This account has no access to that branch');
  return {
    token: signToken(user.id, user.shopId),
    user,
    shop: await findShop(pool, user.shopId),
  };
}
