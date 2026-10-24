import cors from 'cors';
import express from 'express';
import { env } from './config/env';
import { pool } from './db/pool';
import { ah } from './lib/asyncHandler';
import { requireAuth } from './middleware/auth';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { authRouter } from './modules/auth/auth.routes';
import { customersRouter } from './modules/customers/customers.routes';
import { dashboardRouter } from './modules/dashboard/dashboard.routes';
import { invoicesRouter, publicInvoicesRouter } from './modules/invoices/invoices.routes';
import { ordersRouter } from './modules/orders/orders.routes';
import { branchesRouter, shopRouter } from './modules/shop/shop.routes';

export const app = express();

app.disable('x-powered-by');
// Comma-separated, so production and Vercel preview URLs can both be allowed.
app.use(cors({ origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()) }));
app.use(express.json({ limit: '100kb' }));

app.get(
  '/api/health',
  ah(async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  }),
);

app.use('/api/auth', authRouter);
app.use('/api/public', publicInvoicesRouter);

app.use('/api', requireAuth);
app.use('/api/shop', shopRouter);
app.use('/api/branches', branchesRouter);
app.use('/api/customers', customersRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api', invoicesRouter);

app.use(notFoundHandler);
app.use(errorHandler);
