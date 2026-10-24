import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool';
import { ah } from '../../lib/asyncHandler';
import { AppError, notFound } from '../../lib/errors';
import { idParam, paged, paginationQuery } from '../../lib/validation';
import { auth } from '../../middleware/auth';
import { findOrder } from '../orders/orders.repo';
import { renderInvoicePdf } from './invoicePdf';
import { invoicesSummary, listInvoices, listInvoicesForOrder } from './invoices.repo';
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
  status: z.enum(['issued', 'superseded', 'void']).optional(),
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

invoicesRouter.get(
  '/invoices/:id/pdf',
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const invoice = await service.getInvoice(auth(req).shopId, id);
    let pdf: Buffer;
    try {
      pdf = await renderInvoicePdf(invoice);
    } catch (err) {
      console.error('Invoice PDF failed', err);
      throw new AppError(500, 'INVOICE_PDF_FAILED', 'Could not generate the invoice PDF. Please try again.');
    }
    const name = invoice.revision > 1 ? `${invoice.invoiceNumber}-R${invoice.revision}` : invoice.invoiceNumber;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${name}.pdf"`);
    res.setHeader('Content-Length', String(pdf.length));
    res.send(pdf);
  }),
);
