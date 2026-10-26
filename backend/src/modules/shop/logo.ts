import { randomBytes } from 'crypto';
import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool';
import { withTransaction } from '../../db/tx';
import { ah } from '../../lib/asyncHandler';
import { AppError, notFound } from '../../lib/errors';

export const LOGO_MAX_BYTES = 400_000;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * The browser resizes every logo to a PNG before uploading (PDFs can only embed PNG/JPEG,
 * and PNG keeps transparent backgrounds). The server only checks it really is a small PNG.
 */
export function decodeLogo(dataUrl: string): Buffer {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new AppError(400, 'INVALID_LOGO', 'Logo must be a PNG image');
  const png = Buffer.from(m[1], 'base64');
  if (png.length > LOGO_MAX_BYTES) throw new AppError(400, 'INVALID_LOGO', 'Logo is too large (max 400 KB)');
  if (png.length < 8 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new AppError(400, 'INVALID_LOGO', 'Logo must be a PNG image');
  }
  return png;
}

/** Stores a new logo under a fresh key and makes it the branch's current logo. */
export async function saveLogo(shopId: number, png: Buffer): Promise<string> {
  const key = randomBytes(16).toString('base64url');
  await withTransaction(async (c) => {
    await c.query(`INSERT INTO shop_logos (key, shop_id, mime, data) VALUES ($1, $2, 'image/png', $3)`, [key, shopId, png]);
    await c.query(`UPDATE shops SET logo_key = $2, updated_at = now() WHERE id = $1`, [shopId, key]);
  });
  return key;
}

/** For the PDF: the logo as a data URL, or null if missing. */
export async function logoDataUrl(key: string | null | undefined): Promise<string | null> {
  if (!key) return null;
  const { rows } = await pool.query(`SELECT data FROM shop_logos WHERE key = $1`, [key]);
  return rows[0] ? `data:image/png;base64,${(rows[0].data as Buffer).toString('base64')}` : null;
}

/**
 * Public, so <img> tags and emails can load it without a login. The key is random and
 * changes with every upload, so the image can be cached forever.
 */
export const publicLogoRouter = Router();

publicLogoRouter.get(
  '/logos/:key',
  ah(async (req, res) => {
    const { key } = z.object({ key: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/) }).parse(req.params);
    const { rows } = await pool.query(`SELECT mime, data FROM shop_logos WHERE key = $1`, [key]);
    if (!rows[0]) throw notFound('Logo');
    res.setHeader('Content-Type', rows[0].mime);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(rows[0].data);
  }),
);
