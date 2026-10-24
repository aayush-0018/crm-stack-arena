import { NextFunction, Request, Response } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { env } from '../config/env';
import { AppError } from '../lib/errors';

export function signToken(userId: number, shopId: number): string {
  return jwt.sign({ shopId }, env.JWT_SECRET, {
    subject: String(userId),
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new AppError(401, 'UNAUTHENTICATED', 'Please log in'));
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    const userId = Number(payload.sub);
    const shopId = Number(payload.shopId);
    if (!userId || !shopId) throw new Error('bad payload');
    req.auth = { userId, shopId };
    next();
  } catch {
    next(new AppError(401, 'UNAUTHENTICATED', 'Session expired, please log in again'));
  }
}

/** Auth context for a request that passed requireAuth. shopId always comes from the token. */
export function auth(req: Request) {
  if (!req.auth) throw new AppError(401, 'UNAUTHENTICATED', 'Please log in');
  return req.auth;
}
