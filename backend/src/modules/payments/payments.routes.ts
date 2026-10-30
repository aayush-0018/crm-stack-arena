import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../../lib/asyncHandler';
import { assertOwner } from '../../lib/guards';
import { auth } from '../../middleware/auth';
import { getOrder } from '../orders/orders.service';
import { paymentEntrySchema, voidPaymentSchema } from './payments.schemas';
import * as service from './payments.service';

/** Mounted at /api/orders: payments always belong to one order. */
export const paymentsRouter = Router();

const orderParam = z.object({ id: z.coerce.number().int().positive() });
const paymentParam = orderParam.extend({ paymentId: z.coerce.number().int().positive() });

paymentsRouter.post(
  '/:id/payments',
  ah(async (req, res) => {
    const { id } = orderParam.parse(req.params);
    const { userId, shopId } = auth(req);
    const { created } = await service.recordEntry(shopId, userId, id, paymentEntrySchema.parse(req.body));
    res.status(created ? 201 : 200).json(await getOrder(shopId, id));
  }),
);

paymentsRouter.post(
  '/:id/payments/:paymentId/void',
  ah(async (req, res) => {
    const { id, paymentId } = paymentParam.parse(req.params);
    const { userId, shopId } = auth(req);
    await assertOwner(userId, shopId, 'remove payments');
    await service.voidEntry(shopId, userId, id, paymentId, voidPaymentSchema.parse(req.body ?? {}).reason);
    res.json(await getOrder(shopId, id));
  }),
);
