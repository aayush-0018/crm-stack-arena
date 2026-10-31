import { randomBytes } from 'crypto';
import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool';
import { ah } from '../../lib/asyncHandler';
import { AppError, notFound } from '../../lib/errors';
import { assertOwner } from '../../lib/guards';
import { createLimiter } from '../../lib/throttle';
import { idParam } from '../../lib/validation';
import { auth } from '../../middleware/auth';
import { emailCode } from '../dinein/guest.service';
import * as repo from './reservations.repo';
import { bookingCodeSchema, bookingConfirmSchema, dayQuery, reservationSchema, settingsSchema, slotsQuery, statusSchema } from './reservations.schemas';
import * as service from './reservations.service';

const newToken = () => randomBytes(18).toString('base64url');

/** Mounted at /api/reservations. Everyone in the branch takes bookings; owners set the rules and the link. */
export const reservationsRouter = Router();

reservationsRouter.get(
  '/settings',
  ah(async (req, res) => {
    res.json(await repo.getSettings(pool, auth(req).shopId));
  }),
);

reservationsRouter.put(
  '/settings',
  ah(async (req, res) => {
    const { userId, shopId } = auth(req);
    await assertOwner(userId, shopId, 'change the booking settings');
    res.json(await repo.saveSettings(pool, shopId, settingsSchema.parse(req.body)));
  }),
);

/** Turns online booking on, or gives it a new link (the old one stops working). */
reservationsRouter.post(
  '/settings/link',
  ah(async (req, res) => {
    const { userId, shopId } = auth(req);
    await assertOwner(userId, shopId, 'change the booking link');
    res.json(await repo.setBookingToken(pool, shopId, newToken()));
  }),
);

reservationsRouter.delete(
  '/settings/link',
  ah(async (req, res) => {
    const { userId, shopId } = auth(req);
    await assertOwner(userId, shopId, 'turn off online booking');
    res.json(await repo.setBookingToken(pool, shopId, null));
  }),
);

reservationsRouter.get(
  '/',
  ah(async (req, res) => {
    const { date } = dayQuery.parse(req.query);
    res.setHeader('Cache-Control', 'no-store');
    res.json(await repo.listDay(pool, auth(req).shopId, date));
  }),
);

reservationsRouter.post(
  '/',
  ah(async (req, res) => {
    const { userId, shopId } = auth(req);
    res.status(201).json(await service.createReservation(shopId, userId, reservationSchema.parse(req.body)));
  }),
);

reservationsRouter.put(
  '/:id',
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await service.updateReservation(auth(req).shopId, id, reservationSchema.parse(req.body)));
  }),
);

reservationsRouter.post(
  '/:id/status',
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await service.setStatus(auth(req).shopId, id, statusSchema.parse(req.body).status));
  }),
);

// ---------------------------------------------------------------------------------------------
// Public: the branch's booking link (/book/<token>) and each guest's own booking (/b/<token>).
// ---------------------------------------------------------------------------------------------
export const publicBookingRouter = Router();

const tokenParam = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{20,64}$/) });
const lookupsByIp = createLimiter(300, 10 * 60_000);
const confirmsByIp = createLimiter(30, 10 * 60_000);

const noStore = (res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
};

const throttle = (limiter: ReturnType<typeof createLimiter>, req: Request) => {
  const ip = req.ip ?? 'unknown';
  if (limiter.retryAfter(ip) > 0) throw new AppError(429, 'TOO_MANY_TRIES', 'Too many tries. Please wait a few minutes.');
  limiter.hit(ip);
};

async function bookingPage(req: Request) {
  const { token } = tokenParam.parse(req.params);
  const s = await repo.findSettingsByToken(pool, token);
  if (!s) throw notFound('Booking page');
  return s;
}

publicBookingRouter.get(
  '/bookings/:token',
  ah(async (req, res) => {
    const s = await bookingPage(req);
    noStore(res);
    res.json(await service.publicPage(s));
  }),
);

publicBookingRouter.get(
  '/bookings/:token/times',
  ah(async (req, res) => {
    throttle(lookupsByIp, req);
    const s = await bookingPage(req);
    const { date, party } = slotsQuery.parse(req.query);
    noStore(res);
    res.json(await service.availableTimes(s.shopId, s, date, party));
  }),
);

publicBookingRouter.post(
  '/bookings/:token/code',
  ah(async (req, res) => {
    const s = await bookingPage(req);
    res.status(201).json(await emailCode(s.shopId, bookingCodeSchema.parse(req.body), req.ip ?? 'unknown', 'confirm your table booking'));
  }),
);

publicBookingRouter.post(
  '/bookings/:token/confirm',
  ah(async (req, res) => {
    throttle(confirmsByIp, req);
    const s = await bookingPage(req);
    noStore(res);
    res.status(201).json(await service.bookOnline(s, bookingConfirmSchema.parse(req.body)));
  }),
);

publicBookingRouter.get(
  '/reservations/:token',
  ah(async (req, res) => {
    const { token } = tokenParam.parse(req.params);
    noStore(res);
    res.json(await service.guestView(token));
  }),
);

publicBookingRouter.post(
  '/reservations/:token/cancel',
  ah(async (req, res) => {
    const { token } = tokenParam.parse(req.params);
    noStore(res);
    res.json(await service.guestCancel(token));
  }),
);
