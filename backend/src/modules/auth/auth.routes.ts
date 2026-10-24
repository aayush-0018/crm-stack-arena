import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../../lib/asyncHandler';
import { auth, requireAuth } from '../../middleware/auth';
import { loginSchema, registerSchema } from './auth.schemas';
import * as service from './auth.service';

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
    res.json(await service.login(loginSchema.parse(req.body)));
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
