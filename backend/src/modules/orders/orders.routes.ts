import { Router } from 'express';
import { pool } from '../../db/pool';
import { ah } from '../../lib/asyncHandler';
import { idParam, paged } from '../../lib/validation';
import { assertOwner } from '../../lib/guards';
import { auth } from '../../middleware/auth';
import { listOrders } from './orders.repo';
import { createOrderSchema, listOrdersQuery, paymentSchema, statusSchema, updateOrderSchema } from './orders.schemas';
import * as service from './orders.service';

export const ordersRouter = Router();

ordersRouter.get(
  '/',
  ah(async (req, res) => {
    const q = listOrdersQuery.parse(req.query);
    const { rows, total } = await listOrders(pool, auth(req).shopId, q);
    res.json(paged(rows, total, q.page, q.pageSize));
  }),
);

ordersRouter.post(
  '/',
  ah(async (req, res) => {
    const { userId, shopId } = auth(req);
    const { order, created } = await service.createOrder(shopId, userId, createOrderSchema.parse(req.body));
    res.status(created ? 201 : 200).json(order);
  }),
);

ordersRouter.get(
  '/:id',
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await service.getOrder(auth(req).shopId, id));
  }),
);

ordersRouter.put(
  '/:id',
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const { userId, shopId } = auth(req);
    res.json(await service.updateOrder(shopId, userId, id, updateOrderSchema.parse(req.body)));
  }),
);

ordersRouter.patch(
  '/:id/status',
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const { userId, shopId } = auth(req);
    const b = statusSchema.parse(req.body);
    res.json(await service.setStatus(shopId, userId, id, b.status, b.refund));
  }),
);

ordersRouter.patch(
  '/:id/payment',
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const { userId, shopId } = auth(req);
    res.json(await service.setPayment(shopId, userId, id, paymentSchema.parse(req.body).amountPaid));
  }),
);

ordersRouter.delete(
  '/:id',
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const { userId, shopId } = auth(req);
    await assertOwner(userId, shopId, 'delete orders');
    res.json(await service.deleteOrder(shopId, id));
  }),
);
