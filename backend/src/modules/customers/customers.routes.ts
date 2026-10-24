import { Router } from 'express';
import { pool } from '../../db/pool';
import { ah } from '../../lib/asyncHandler';
import { idParam, paged } from '../../lib/validation';
import { auth } from '../../middleware/auth';
import { listOrders } from '../orders/orders.repo';
import { listOrdersQuery } from '../orders/orders.schemas';
import { customersSummary, listCustomers } from './customers.repo';
import { customerInput, listCustomersQuery } from './customers.schemas';
import * as service from './customers.service';

export const customersRouter = Router();

customersRouter.get(
  '/',
  ah(async (req, res) => {
    const q = listCustomersQuery.parse(req.query);
    const { rows, total } = await listCustomers(pool, auth(req).shopId, q);
    res.json(paged(rows, total, q.page, q.pageSize));
  }),
);

customersRouter.get(
  '/summary',
  ah(async (req, res) => {
    res.json(await customersSummary(pool, auth(req).shopId));
  }),
);

customersRouter.post(
  '/',
  ah(async (req, res) => {
    const input = customerInput.parse(req.body);
    res.status(201).json(await service.createCustomer(pool, auth(req).shopId, input));
  }),
);

customersRouter.get(
  '/:id',
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await service.getCustomer(auth(req).shopId, id));
  }),
);

customersRouter.put(
  '/:id',
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await service.updateCustomer(auth(req).shopId, id, customerInput.parse(req.body)));
  }),
);

customersRouter.delete(
  '/:id',
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await service.deleteCustomer(auth(req).shopId, id));
  }),
);

customersRouter.get(
  '/:id/orders',
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const shopId = auth(req).shopId;
    await service.getCustomer(shopId, id); // 404 for unknown / other shop
    const q = listOrdersQuery.parse({ ...req.query, customerId: id });
    const { rows, total } = await listOrders(pool, shopId, q);
    res.json(paged(rows, total, q.page, q.pageSize));
  }),
);
