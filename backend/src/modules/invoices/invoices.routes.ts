import { Response, Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool';
import { ah } from '../../lib/asyncHandler';
import { AppError, notFound } from '../../lib/errors';
import { dateInput, idParam, paged, paginationQuery } from '../../lib/validation';
import { assertOwner } from '../../lib/guards';
import { auth } from '../../middleware/auth';
import { findOrder } from '../orders/orders.repo';
import { logoDataUrl } from '../shop/logo';
import { renderInvoicePdf } from './invoicePdf';
import { findInvoiceByShareToken, Invoice, invoicesSummary, listInvoices, listInvoicesForOrder } from './invoices.repo';
import * as service from './invoices.service';

export const invoicesRouter = Router();

const generateQuery = z.object({ reissue: z.enum(['true', 'false']).optional() });

invoicesRouter.post(
  '/orders/:id/invoice',
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const { userId, shopId } = auth(req);
    const reissue = generateQuery.parse(req.query).reissue === 'true';
    const { id: invoiceId, created } = await service.generateInvoice(shopId, userId, id, reissue);
    res.status(created ? 201 : 200).json(await service.getInvoice(shopId, invoiceId));
  }),
);

invoicesRouter.get(
  '/orders/:id/invoices',
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const shopId = auth(req).shopId;
    if (!(await findOrder(pool, shopId, id))) throw notFound('Order');
    res.json(await listInvoicesForOrder(pool, shopId, id));
  }),
);

const listQuery = paginationQuery.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(['issued', 'needs_reissue', 'superseded', 'void']).optional(),
  from: dateInput.optional(),
  to: dateInput.optional(),
});

invoicesRouter.get(
  '/invoices',
  ah(async (req, res) => {
    const q = listQuery.parse(req.query);
    const { rows, total } = await listInvoices(pool, auth(req).shopId, q);
    res.json(paged(rows, total, q.page, q.pageSize));
  }),
);

invoicesRouter.get(
  '/invoices/summary',
  ah(async (req, res) => {
    res.json(await invoicesSummary(pool, auth(req).shopId));
  }),
);

invoicesRouter.get(
  '/invoices/:id',
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await service.getInvoice(auth(req).shopId, id));
  }),
);

invoicesRouter.post(
  '/invoices/:id/share-link',
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json({ token: await service.getShareToken(auth(req).shopId, id) });
  }),
);

invoicesRouter.post(
  '/invoices/:id/share-link/reset',
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json({ token: await service.resetShareToken(auth(req).shopId, id) });
  }),
);

const shareBody = z.object({
  channel: z.enum(['whatsapp', 'email', 'share', 'link', 'download']),
  recipient: z.string().trim().max(200).nullish(),
});

invoicesRouter.post(
  '/invoices/:id/shares',
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const { userId, shopId } = auth(req);
    const b = shareBody.parse(req.body);
    res.status(201).json(await service.recordShare(shopId, userId, id, b.channel, b.recipient ?? null));
  }),
);

invoicesRouter.delete(
  '/invoices/:id',
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const { userId, shopId } = auth(req);
    await assertOwner(userId, shopId, 'delete invoices');
    res.json(await service.deleteInvoice(shopId, id));
  }),
);

invoicesRouter.get(
  '/invoices/:id/pdf',
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    await sendPdf(res, await service.getInvoice(auth(req).shopId, id));
  }),
);

async function sendPdf(res: Response, invoice: Invoice) {
  let pdf: Buffer;
  try {
    pdf = await renderInvoicePdf(invoice, await logoDataUrl(invoice.shopSnapshot.logoKey));
  } catch (err) {
    console.error('Invoice PDF failed', err);
    throw new AppError(500, 'INVOICE_PDF_FAILED', 'Could not generate the invoice PDF. Please try again.');
  }
  const name = invoice.revision > 1 ? `${invoice.invoiceNumber}-R${invoice.revision}` : invoice.invoiceNumber;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${name}.pdf"`);
  res.setHeader('Content-Length', String(pdf.length));
  res.send(pdf);
}

/** No login: the share token in the URL is the permission, and it unlocks one invoice only. */
export const publicInvoicesRouter = Router();

publicInvoicesRouter.get(
  '/invoices/:token/pdf',
  ah(async (req, res) => {
    const { token } = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{20,64}$/) }).parse(req.params);
    const invoice = await findInvoiceByShareToken(pool, token);
    if (!invoice) throw notFound('Invoice');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    await sendPdf(res, invoice);
  }),
);
