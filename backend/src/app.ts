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
import { paymentsRouter } from './modules/payments/payments.routes';
import { productsRouter } from './modules/products/products.routes';
import { publicLogoRouter } from './modules/shop/logo';
import { branchesRouter, shopRouter } from './modules/shop/shop.routes';

export const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);
// Comma-separated, so production and Vercel preview URLs can both be allowed.
app.use(cors({ origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()) }));
// Logos are uploaded as base64 PNG (up to 400 KB -> ~540 KB of JSON); everything else stays small.
const smallJson = express.json({ limit: '100kb' });
const logoJson = express.json({ limit: '600kb' });
app.use((req, res, next) => (req.path === '/api/shop/logo' ? logoJson : smallJson)(req, res, next));

app.get(
  '/api/health',
  ah(async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  }),
);

app.use('/api/auth', authRouter);
app.use('/api/public', publicInvoicesRouter);
app.use('/api/public', publicLogoRouter);

app.use('/api', requireAuth);
app.use('/api/shop', shopRouter);
app.use('/api/branches', branchesRouter);
app.use('/api/customers', customersRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/orders', paymentsRouter);
app.use('/api/products', productsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api', invoicesRouter);

app.use(notFoundHandler);
app.use(errorHandler);
