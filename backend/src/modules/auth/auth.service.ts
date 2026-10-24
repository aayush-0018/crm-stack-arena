import bcrypt from 'bcrypt';
import { z } from 'zod';
import { pool } from '../../db/pool';
import { withTransaction } from '../../db/tx';
import { AppError } from '../../lib/errors';
import { signToken } from '../../middleware/auth';
import { findShop } from '../shop/shop.repo';
import { loginSchema, registerSchema } from './auth.schemas';

const BCRYPT_COST = 12;
const USER_COLS = `id, shop_id AS "shopId", name, email, role`;

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
    return u.rows[0];
  });

  return session(user);
}

export async function login(input: z.infer<typeof loginSchema>) {
  const { rows } = await pool.query(
    `SELECT ${USER_COLS}, password_hash AS "passwordHash" FROM users WHERE lower(email) = $1`,
    [input.email],
  );
  const row = rows[0];
  const ok = row ? await bcrypt.compare(input.password, row.passwordHash) : false;
  if (!ok) throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  const { passwordHash: _omit, ...user } = row;
  return session(user);
}

export async function me(userId: number, shopId: number) {
  const { rows } = await pool.query(`SELECT ${USER_COLS} FROM users WHERE id = $1 AND shop_id = $2`, [
    userId,
    shopId,
  ]);
  if (!rows[0]) throw new AppError(401, 'UNAUTHENTICATED', 'Please log in');
  return { user: rows[0], shop: await findShop(pool, shopId) };
}

async function session(user: { id: number; shopId: number }) {
  return {
    token: signToken(user.id, user.shopId),
    user,
    shop: await findShop(pool, user.shopId),
  };
}
