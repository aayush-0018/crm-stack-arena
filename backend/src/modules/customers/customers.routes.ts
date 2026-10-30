import { Router } from 'express';
import { pool } from '../../db/pool';
import { ah } from '../../lib/asyncHandler';
import { idParam, paged } from '../../lib/validation';
import { assertOwner } from '../../lib/guards';
import { auth } from '../../middleware/auth';
import { listOrders } from '../orders/orders.repo';
import { listOrdersQuery } from '../orders/orders.schemas';
import { customersSummary, listCustomers } from './customers.repo';
import { parseImportBody } from '../../lib/importRows';
import { importCustomers } from './customers.import';
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

/** CSV import (rows already parsed by the browser). dryRun = preview only; nothing is saved. */
customersRouter.post(
  '/import',
  ah(async (req, res) => {
    const { rows, dryRun } = parseImportBody(req.body);
    res.json(await importCustomers(auth(req).shopId, rows, dryRun));
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
    const { userId, shopId } = auth(req);
    await assertOwner(userId, shopId, 'delete customers');
    res.json(await service.deleteCustomer(shopId, userId, id, req.query.purge === 'true'));
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
