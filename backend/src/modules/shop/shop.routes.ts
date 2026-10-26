import { Router } from 'express';
import { pool } from '../../db/pool';
import { ah } from '../../lib/asyncHandler';
import { withTransaction } from '../../db/tx';
import { assertOwner } from '../../lib/guards';
import { decodeLogo, saveLogo } from './logo';
import { z } from 'zod';
import { AppError, notFound } from '../../lib/errors';
import { auth } from '../../middleware/auth';
import { codeTakenByOtherBranch, findShop, listBranches, membershipRole, SHOP_COLS } from './shop.repo';
import { createBranchSchema, updateShopSchema } from './shop.schemas';

export const shopRouter = Router();

shopRouter.get(
  '/',
  ah(async (req, res) => {
    const shop = await findShop(pool, auth(req).shopId);
    if (!shop) throw notFound('Shop');
    res.json(shop);
  }),
);

shopRouter.put(
  '/',
  ah(async (req, res) => {
    const b = updateShopSchema.parse(req.body);
    const { userId, shopId } = auth(req);
    if (b.code && (await codeTakenByOtherBranch(pool, userId, b.code, shopId))) throw codeTaken();
    const { rows } = await pool.query(
      `UPDATE shops SET name = $2, phone = $3, email = $4, address_line1 = $5, address_line2 = $6,
         city = $7, state = $8, pincode = $9, gstin = $10, code = $11, updated_at = now()
       WHERE id = $1 RETURNING ${SHOP_COLS}`,
      [shopId, b.name, b.phone, b.email, b.addressLine1, b.addressLine2, b.city, b.state, b.pincode, b.gstin, b.code],
    );
    if (!rows[0]) throw notFound('Shop');
    res.json(rows[0]);
  }),
);

shopRouter.put(
  '/logo',
  ah(async (req, res) => {
    const { userId, shopId } = auth(req);
    await assertOwner(userId, shopId, 'change the logo');
    const { dataUrl } = z.object({ dataUrl: z.string() }).parse(req.body);
    await saveLogo(shopId, decodeLogo(dataUrl));
    res.json(await findShop(pool, shopId));
  }),
);

shopRouter.delete(
  '/logo',
  ah(async (req, res) => {
    const { userId, shopId } = auth(req);
    await assertOwner(userId, shopId, 'remove the logo');
    // Old logo rows stay: invoices issued with them keep showing them.
    await pool.query(`UPDATE shops SET logo_key = NULL, updated_at = now() WHERE id = $1`, [shopId]);
    res.json(await findShop(pool, shopId));
  }),
);

const codeTaken = () =>
  new AppError(409, 'CODE_TAKEN', 'Another of your branches already uses this code', {
    code: 'Another of your branches already uses this code',
  });

/** Branches: every branch is a separate shop with its own data. */
export const branchesRouter = Router();

branchesRouter.get(
  '/',
  ah(async (req, res) => {
    res.json(await listBranches(pool, auth(req).userId));
  }),
);

branchesRouter.post(
  '/',
  ah(async (req, res) => {
    const { userId, shopId } = auth(req);
    if ((await membershipRole(pool, userId, shopId)) !== 'owner') {
      throw new AppError(403, 'FORBIDDEN', 'Only an owner can add branches');
    }
    const b = createBranchSchema.parse(req.body);
    if (b.code && (await codeTakenByOtherBranch(pool, userId, b.code))) throw codeTaken();

    const branch = await withTransaction(async (c) => {
      const { rows } = await c.query(
        // A new branch starts with the current branch's logo; it can be changed in its settings.
        `INSERT INTO shops (name, code, city, phone, logo_key)
         VALUES ($1, $2, $3, $4, (SELECT logo_key FROM shops WHERE id = $5))
         RETURNING id, name, code, city, logo_key AS "logoKey"`,
        [b.name, b.code, b.city, b.phone, shopId],
      );
      await c.query(`INSERT INTO shop_counters (shop_id) VALUES ($1)`, [rows[0].id]);
      await c.query(`INSERT INTO shop_members (user_id, shop_id, role) VALUES ($1, $2, 'owner')`, [userId, rows[0].id]);
      return { ...rows[0], role: 'owner' as const };
    });
    res.status(201).json(branch);
  }),
);
