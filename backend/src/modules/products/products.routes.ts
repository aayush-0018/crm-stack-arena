import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool';
import { withTransaction } from '../../db/tx';
import { ah } from '../../lib/asyncHandler';
import { AppError, isUniqueViolation, notFound } from '../../lib/errors';
import { idParam, paged } from '../../lib/validation';
import { auth } from '../../middleware/auth';
import * as repo from './products.repo';
import { createProductSchema, listProductsQuery, productInput, stockEntrySchema } from './products.schemas';
import { recordStockEntry } from './stock.service';
import { parseImportBody } from '../../lib/importRows';
import { importProducts } from './products.import';

export const productsRouter = Router();

/** Unique-index violations -> a message on the right field. */
function friendlyConflict(err: unknown): never {
  if (isUniqueViolation(err, 'products_shop_name_uq')) {
    throw new AppError(409, 'PRODUCT_EXISTS', 'A product with this name already exists', { name: 'A product with this name already exists' });
  }
  if (isUniqueViolation(err, 'products_shop_sku_uq')) {
    throw new AppError(409, 'SKU_EXISTS', 'Another product already uses this SKU', { sku: 'Another product already uses this SKU' });
  }
  throw err;
}

async function detail(shopId: number, id: number) {
  const product = await repo.findProduct(pool, shopId, id);
  if (!product) throw notFound('Product');
  return { ...product, movements: await repo.listMovements(pool, shopId, id) };
}

productsRouter.get(
  '/',
  ah(async (req, res) => {
    const q = listProductsQuery.parse(req.query);
    const { rows, total } = await repo.listProducts(pool, auth(req).shopId, q);
    res.json(paged(rows, total, q.page, q.pageSize));
  }),
);

productsRouter.get(
  '/low-stock-count',
  ah(async (req, res) => {
    res.json({ count: await repo.countLowStock(pool, auth(req).shopId) });
  }),
);

productsRouter.post(
  '/',
  ah(async (req, res) => {
    const { userId, shopId } = auth(req);
    const input = createProductSchema.parse(req.body);
    const id = await withTransaction(async (c) => {
      const pid = await repo.insertProduct(c, shopId, input);
      if (input.openingStock && input.trackStock) {
        await repo.insertMovement(c, { shopId, productId: pid, kind: 'opening', qtyMilli: input.openingStock, userId });
      }
      return pid;
    }).catch(friendlyConflict);
    res.status(201).json(await detail(shopId, id));
  }),
);

/** CSV import (rows already parsed by the browser). dryRun = preview only; nothing is saved. */
productsRouter.post(
  '/import',
  ah(async (req, res) => {
    const { userId, shopId } = auth(req);
    const { rows, dryRun } = parseImportBody(req.body);
    res.json(await importProducts(shopId, userId, rows, dryRun));
  }),
);

productsRouter.get(
  '/:id',
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await detail(auth(req).shopId, id));
  }),
);

productsRouter.put(
  '/:id',
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const shopId = auth(req).shopId;
    // Past orders keep their own copy of name and price, so editing here never changes them.
    const ok = await repo.updateProduct(pool, shopId, id, productInput.parse(req.body)).catch(friendlyConflict);
    if (!ok) throw notFound('Product');
    res.json(await detail(shopId, id));
  }),
);

/** Archive / restore. Products are never deleted: orders and the stock history refer to them. */
productsRouter.patch(
  '/:id/active',
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const shopId = auth(req).shopId;
    const { active } = z.object({ active: z.boolean() }).parse(req.body);
    const ok = await repo.setActive(pool, shopId, id, active).catch(friendlyConflict);
    if (!ok) throw notFound('Product');
    res.json(await detail(shopId, id));
  }),
);

productsRouter.post(
  '/:id/stock',
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const { userId, shopId } = auth(req);
    const { changed } = await recordStockEntry(shopId, userId, id, stockEntrySchema.parse(req.body));
    res.status(changed ? 201 : 200).json(await detail(shopId, id));
  }),
);
