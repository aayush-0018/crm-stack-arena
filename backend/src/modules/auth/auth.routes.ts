import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../../lib/asyncHandler';
import { auth, requireAuth } from '../../middleware/auth';
import { loginSchema, registerSchema } from './auth.schemas';
import * as service from './auth.service';
import * as passwords from './password.service';

export const authRouter = Router();

authRouter.post(
  '/register',
  ah(async (req, res) => {
    res.status(201).json(await service.register(registerSchema.parse(req.body)));
  }),
);

authRouter.post(
  '/login',
  ah(async (req, res) => {
    res.json(await service.login(loginSchema.parse(req.body), req.ip ?? 'unknown'));
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  ah(async (req, res) => {
    const { userId, shopId } = auth(req);
    res.json(await service.me(userId, shopId));
  }),
);

authRouter.post(
  '/switch-branch',
  requireAuth,
  ah(async (req, res) => {
    const { shopId } = z.object({ shopId: z.coerce.number().int().positive() }).parse(req.body);
    res.json(await service.switchBranch(auth(req).userId, shopId));
  }),
);

authRouter.post(
  '/forgot-password',
  ah(async (req, res) => {
    const { email } = z.object({ email: z.string().trim().toLowerCase().email('Enter a valid email') }).parse(req.body);
    await passwords.requestReset(email, req.ip ?? 'unknown');
    // Same answer whether or not the account exists.
    res.json({ ok: true });
  }),
);

const tokenParam = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{40,64}$/, 'Invalid link') });

authRouter.get(
  '/reset-password/:token',
  ah(async (req, res) => {
    const parsed = tokenParam.safeParse(req.params);
    res.json(parsed.success ? await passwords.checkResetToken(parsed.data.token) : { valid: false });
  }),
);

authRouter.post(
  '/reset-password',
  ah(async (req, res) => {
    const b = tokenParam
      .extend({ password: z.string().min(8, 'Password must be at least 8 characters').max(72) })
      .parse(req.body);
    res.json(await passwords.resetPassword(b.token, b.password));
  }),
);
