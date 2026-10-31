import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool';
import { ah } from '../../lib/asyncHandler';
import { AppError, notFound } from '../../lib/errors';
import { assertOwner } from '../../lib/guards';
import { createLimiter } from '../../lib/throttle';
import { idParam } from '../../lib/validation';
import { auth } from '../../middleware/auth';
import { catalogueProducts } from '../catalogue/catalogue.repo';
import { findShop } from '../shop/shop.repo';
import { floorPlanSchema, guestOrderSchema, guestOtpRequestSchema, guestOtpVerifySchema, kitchenStatusSchema, markPaidSchema } from './dinein.schemas';
import * as guests from './guest.service';
import * as service from './dinein.service';

/** Mounted at /api/floor-plan. Anyone in the branch can see it; owners draw and lock it. */
export const floorPlanRouter = Router();

floorPlanRouter.get(
  '/',
  ah(async (req, res) => {
    res.json(await service.getFloorPlan(pool, auth(req).shopId));
  }),
);

floorPlanRouter.put(
  '/',
  ah(async (req, res) => {
    const { userId, shopId } = auth(req);
    await assertOwner(userId, shopId, 'change the floor plan');
    res.json(await service.saveFloorPlan(shopId, userId, floorPlanSchema.parse(req.body)));
  }),
);

floorPlanRouter.put(
  '/lock',
  ah(async (req, res) => {
    const { userId, shopId } = auth(req);
    await assertOwner(userId, shopId, 'lock or unlock the floor plan');
    const { locked } = z.object({ locked: z.boolean() }).parse(req.body);
    res.json(await service.setLocked(shopId, userId, locked));
  }),
);

/** A new QR code for one table; the printed old one stops working. */
floorPlanRouter.post(
  '/tables/:id/new-qr',
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const { userId, shopId } = auth(req);
    await assertOwner(userId, shopId, 'replace a table QR code');
    res.json(await service.newTableQr(shopId, id));
  }),
);

floorPlanRouter.get(
  '/live',
  ah(async (req, res) => {
    res.json(await service.liveFloor(auth(req).shopId));
  }),
);

/** Mounted at /api/kitchen: the kitchen screen. Staff and owners alike. */
export const kitchenRouter = Router();

kitchenRouter.get(
  '/',
  ah(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await service.kitchenOrders(auth(req).shopId));
  }),
);

kitchenRouter.patch(
  '/:id',
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const shopId = auth(req).shopId;
    await service.setKitchenStatus(shopId, id, kitchenStatusSchema.parse(req.body).status);
    res.json(await service.kitchenOrders(shopId));
  }),
);

kitchenRouter.post(
  '/:id/paid',
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const { userId, shopId } = auth(req);
    await service.markPaid(shopId, userId, id, markPaidSchema.parse(req.body).method);
    res.json(await service.liveFloor(shopId));
  }),
);

// ---------------------------------------------------------------------------------------------
// Public: guests at a table. The QR token opens that table's menu and ordering only; the guest's
// session (after confirming their email) is sent in the X-Guest-Session header.
// ---------------------------------------------------------------------------------------------
export const publicTablesRouter = Router();

const tokenParam = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{20,64}$/) });
const session = (req: Request) => req.get('x-guest-session') ?? undefined;
// Guests share café Wi-Fi, so the per-address limit is generous; the per-table one stops a runaway script.
const ordersByIp = createLimiter(30, 10 * 60_000);
const ordersByTable = createLimiter(20, 10 * 60_000);
const verifyByIp = createLimiter(30, 10 * 60_000);

const noStore = (res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
};

publicTablesRouter.get(
  '/tables/:token',
  ah(async (req, res) => {
    const { token } = tokenParam.parse(req.params);
    const { table, session: s, discountPct } = await guests.tableMenu(token, session(req));
    const shop = await findShop(pool, table.shopId);
    if (!shop) throw notFound('Table');
    noStore(res);
    res.json({
      shop: { name: shop.name, logoKey: shop.logoKey, phone: shop.phone },
      table: { label: table.label, floorName: table.floorName },
      firstOrderDiscountPct: guests.FIRST_ORDER_DISCOUNT_PCT,
      // The menu opens only after the guest has confirmed their email.
      guest: s ? { name: s.name, phone: s.phone, email: s.email, discountPct } : null,
      products: s
        ? (await catalogueProducts(pool, table.shopId, true)).map(({ id, name, category, unit, pricePaise }) => ({ id, name, category, unit, pricePaise }))
        : [],
    });
  }),
);

publicTablesRouter.post(
  '/tables/:token/code',
  ah(async (req, res) => {
    const { token } = tokenParam.parse(req.params);
    res.status(201).json(await guests.requestCode(token, guestOtpRequestSchema.parse(req.body), req.ip ?? 'unknown'));
  }),
);

publicTablesRouter.post(
  '/tables/:token/verify',
  ah(async (req, res) => {
    const { token } = tokenParam.parse(req.params);
    const ip = req.ip ?? 'unknown';
    if (verifyByIp.retryAfter(ip) > 0) throw new AppError(429, 'TOO_MANY_TRIES', 'Too many tries. Please wait a few minutes.');
    verifyByIp.hit(ip);
    const { challenge, code } = guestOtpVerifySchema.parse(req.body);
    noStore(res);
    res.json(await guests.verifyCode(token, challenge, code));
  }),
);

publicTablesRouter.get(
  '/tables/:token/my-orders',
  ah(async (req, res) => {
    const { token } = tokenParam.parse(req.params);
    noStore(res);
    res.json(await guests.myOrders(token, session(req)));
  }),
);

publicTablesRouter.post(
  '/tables/:token/orders',
  ah(async (req, res) => {
    const { token } = tokenParam.parse(req.params);
    const ip = req.ip ?? 'unknown';
    const wait = Math.max(ordersByIp.retryAfter(ip), ordersByTable.retryAfter(token));
    if (wait > 0) {
      res.setHeader('Retry-After', String(Math.ceil(wait / 1000)));
      throw new AppError(429, 'TOO_MANY_ORDERS', 'Too many orders from this table just now. Please ask the staff for help.');
    }
    const input = guestOrderSchema.parse(req.body);
    ordersByIp.hit(ip);
    ordersByTable.hit(token);
    res.status(201).json(await guests.placeGuestOrder(token, session(req), input));
  }),
);

publicTablesRouter.get(
  '/table-orders/:token',
  ah(async (req, res) => {
    const { token } = tokenParam.parse(req.params);
    noStore(res);
    res.json(await guests.guestOrderView(token));
  }),
);
