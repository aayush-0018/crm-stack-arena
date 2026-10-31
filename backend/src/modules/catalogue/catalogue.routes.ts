import { randomBytes } from 'crypto';
import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool';
import { ah } from '../../lib/asyncHandler';
import { AppError, notFound } from '../../lib/errors';
import { assertOwner } from '../../lib/guards';
import { optionalText } from '../../lib/validation';
import { auth } from '../../middleware/auth';
import { findShop } from '../shop/shop.repo';
import * as repo from './catalogue.repo';

const newToken = () => randomBytes(18).toString('base64url');

const settingsSchema = z.object({
  template: z.enum(repo.CATALOGUE_TEMPLATES),
  title: optionalText(80),
  tagline: optionalText(160),
  showPrices: z.boolean(),
  hideOutOfStock: z.boolean(),
  showBranches: z.boolean(),
});

/** Mounted at /api/catalogue: the current branch's catalogue settings and link. */
export const catalogueRouter = Router();

catalogueRouter.get(
  '/',
  ah(async (req, res) => {
    res.json(await repo.findCatalogue(pool, auth(req).shopId));
  }),
);

/** The one-click button: creates the catalogue (or turns its link back on) and returns it. */
catalogueRouter.post(
  '/',
  ah(async (req, res) => {
    const { userId, shopId } = auth(req);
    await assertOwner(userId, shopId, 'publish the catalogue');
    res.json(await repo.enableCatalogue(pool, shopId, userId, newToken()));
  }),
);

catalogueRouter.put(
  '/',
  ah(async (req, res) => {
    const { userId, shopId } = auth(req);
    await assertOwner(userId, shopId, 'change the catalogue');
    const updated = await repo.updateCatalogue(pool, shopId, settingsSchema.parse(req.body));
    if (!updated) throw notFound('Catalogue');
    res.json(updated);
  }),
);

catalogueRouter.post(
  '/reset-link',
  ah(async (req, res) => {
    const { userId, shopId } = auth(req);
    await assertOwner(userId, shopId, 'reset the catalogue link');
    const current = await repo.findCatalogue(pool, shopId);
    if (!current) throw notFound('Catalogue');
    if (!current.token) throw new AppError(409, 'LINK_OFF', 'The catalogue link is turned off. Turn it on first.');
    res.json(await repo.setToken(pool, shopId, newToken()));
  }),
);

/** Turns the public link off. Settings are kept for when it is turned on again (with a new link). */
catalogueRouter.delete(
  '/link',
  ah(async (req, res) => {
    const { userId, shopId } = auth(req);
    await assertOwner(userId, shopId, 'turn off the catalogue link');
    const updated = await repo.setToken(pool, shopId, null);
    if (!updated) throw notFound('Catalogue');
    res.json(updated);
  }),
);

/** No login: the token is the permission, and it shows this one branch's catalogue only. */
export const publicCatalogueRouter = Router();

publicCatalogueRouter.get(
  '/catalogues/:token',
  ah(async (req, res) => {
    const { token } = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{20,64}$/) }).parse(req.params);
    const cat = await repo.findByToken(pool, token);
    const shop = cat && (await findShop(pool, cat.shopId));
    if (!cat || !shop) throw notFound('Catalogue');
    const [products, branches] = await Promise.all([
      repo.catalogueProducts(pool, cat.shopId, cat.hideOutOfStock),
      cat.showBranches ? repo.siblingBranches(pool, cat.shopId) : Promise.resolve([]),
    ]);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.json({
      template: cat.template,
      title: cat.title,
      tagline: cat.tagline,
      showPrices: cat.showPrices,
      // Only what a printed catalogue would show: no GSTIN, settings or internal codes.
      shop: {
        name: shop.name,
        phone: shop.phone,
        email: shop.email,
        addressLine1: shop.addressLine1,
        addressLine2: shop.addressLine2,
        city: shop.city,
        state: shop.state,
        pincode: shop.pincode,
        logoKey: shop.logoKey,
      },
      branches,
      products: products.map((p) => ({ ...p, pricePaise: cat.showPrices ? p.pricePaise : null })),
      truncated: products.length >= repo.CATALOGUE_MAX_PRODUCTS,
      generatedAt: new Date().toISOString(),
    });
  }),
);
