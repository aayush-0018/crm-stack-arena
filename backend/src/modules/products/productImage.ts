import { randomBytes } from 'crypto';
import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool';
import { withTransaction } from '../../db/tx';
import { ah } from '../../lib/asyncHandler';
import { AppError, notFound } from '../../lib/errors';

export const PRODUCT_IMAGE_MAX_BYTES = 400_000;
const SIGNATURES: Record<string, Buffer> = {
  'image/jpeg': Buffer.from([0xff, 0xd8, 0xff]),
  'image/png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
};

/**
 * The browser shrinks every photo to a JPEG (or a PNG, for transparent ones) before uploading.
 * The server only checks it really is a small JPEG or PNG.
 */
export function decodeProductImage(dataUrl: string): { mime: string; data: Buffer } {
  const m = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new AppError(400, 'INVALID_IMAGE', 'The image must be a JPEG or PNG');
  const data = Buffer.from(m[2], 'base64');
  if (data.length > PRODUCT_IMAGE_MAX_BYTES) throw new AppError(400, 'INVALID_IMAGE', 'The image is too large (max 400 KB)');
  const sig = SIGNATURES[m[1]];
  if (data.length < sig.length || !data.subarray(0, sig.length).equals(sig)) {
    throw new AppError(400, 'INVALID_IMAGE', 'The image must be a JPEG or PNG');
  }
  return { mime: m[1], data };
}

/** Stores the image under a fresh key and makes it the product's current one. False if no such product. */
export async function saveProductImage(shopId: number, productId: number, img: { mime: string; data: Buffer }): Promise<boolean> {
  const key = randomBytes(16).toString('base64url');
  return withTransaction(async (c) => {
    const { rowCount } = await c.query(`UPDATE products SET image_key = $3, updated_at = now() WHERE shop_id = $1 AND id = $2`, [shopId, productId, key]);
    if (!rowCount) return false;
    await c.query(`INSERT INTO product_images (key, shop_id, product_id, mime, data) VALUES ($1, $2, $3, $4, $5)`, [key, shopId, productId, img.mime, img.data]);
    return true;
  });
}

export async function removeProductImage(shopId: number, productId: number): Promise<boolean> {
  const { rowCount } = await pool.query(`UPDATE products SET image_key = NULL, updated_at = now() WHERE shop_id = $1 AND id = $2`, [shopId, productId]);
  return !!rowCount;
}

/** Public, so the catalogue and the table menu can show it without a login. Keys are random and never reused. */
export const publicProductImageRouter = Router();

publicProductImageRouter.get(
  '/product-images/:key',
  ah(async (req, res) => {
    const { key } = z.object({ key: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/) }).parse(req.params);
    const { rows } = await pool.query(`SELECT mime, data FROM product_images WHERE key = $1`, [key]);
    if (!rows[0]) throw notFound('Image');
    res.setHeader('Content-Type', rows[0].mime);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(rows[0].data);
  }),
);
