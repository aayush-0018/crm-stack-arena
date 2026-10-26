import { NextFunction, Request, Response } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { env } from '../config/env';
import { pool } from '../db/pool';
import { AppError } from '../lib/errors';

export function signToken(userId: number, shopId: number): string {
  return jwt.sign({ shopId }, env.JWT_SECRET, {
    subject: String(userId),
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

// userId -> when their password last changed (ms, or null). Cached briefly to avoid a
// database round trip on every request; cleared immediately when a password changes.
const changedAtCache = new Map<number, { changedAt: number | null; exists: boolean; at: number }>();
const CACHE_MS = 60_000;

export const forgetSessionCache = (userId: number) => changedAtCache.delete(userId);

async function passwordState(userId: number) {
  const hit = changedAtCache.get(userId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit;
  const { rows } = await pool.query(`SELECT password_changed_at AS "changedAt" FROM users WHERE id = $1`, [userId]);
  const state = { exists: !!rows[0], changedAt: rows[0]?.changedAt ? new Date(rows[0].changedAt).getTime() : null, at: Date.now() };
  changedAtCache.set(userId, state);
  return state;
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new AppError(401, 'UNAUTHENTICATED', 'Please log in'));
  let payload: JwtPayload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
  } catch {
    return next(new AppError(401, 'UNAUTHENTICATED', 'Session expired, please log in again'));
  }
  const userId = Number(payload.sub);
  const shopId = Number(payload.shopId);
  if (!userId || !shopId) return next(new AppError(401, 'UNAUTHENTICATED', 'Please log in'));

  passwordState(userId)
    .then(({ exists, changedAt }) => {
      // Tokens carry whole seconds; anything issued before the change second is stale.
      if (!exists || (changedAt && (payload.iat ?? 0) < Math.floor(changedAt / 1000))) {
        return next(new AppError(401, 'UNAUTHENTICATED', 'Your password was changed. Please log in again.'));
      }
      req.auth = { userId, shopId };
      next();
    })
    .catch(next);
}

/** Auth context for a request that passed requireAuth. shopId always comes from the token. */
export function auth(req: Request) {
  if (!req.auth) throw new AppError(401, 'UNAUTHENTICATED', 'Please log in');
  return req.auth;
}
