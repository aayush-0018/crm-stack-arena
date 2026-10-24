import { Router } from 'express';
import { pool } from '../../db/pool';
import { ah } from '../../lib/asyncHandler';
import { notFound } from '../../lib/errors';
import { auth } from '../../middleware/auth';
import { findShop, SHOP_COLS } from './shop.repo';
import { updateShopSchema } from './shop.schemas';

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
    const { rows } = await pool.query(
      `UPDATE shops SET name = $2, phone = $3, email = $4, address_line1 = $5, address_line2 = $6,
         city = $7, state = $8, pincode = $9, gstin = $10, updated_at = now()
       WHERE id = $1 RETURNING ${SHOP_COLS}`,
      [auth(req).shopId, b.name, b.phone, b.email, b.addressLine1, b.addressLine2, b.city, b.state, b.pincode, b.gstin],
    );
    if (!rows[0]) throw notFound('Shop');
    res.json(rows[0]);
  }),
);
