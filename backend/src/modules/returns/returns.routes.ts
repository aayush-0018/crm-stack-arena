import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../../lib/asyncHandler';
import { AppError } from '../../lib/errors';
import { idParam } from '../../lib/validation';
import { auth } from '../../middleware/auth';
import { getOrder } from '../orders/orders.service';
import { logoDataUrl } from '../shop/logo';
import { renderReturnPdf } from './returnPdf';
import { returnSchema } from './returns.schemas';
import { createReturn, getReturn } from './returns.service';

/** Mounted at /api. */
export const returnsRouter = Router();

/** Return items from an order. dryRun = preview (value, refund, new balance) without saving. */
returnsRouter.post(
  '/orders/:id/returns',
  ah(async (req, res) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    const { userId, shopId } = auth(req);
    const result = await createReturn(shopId, userId, id, returnSchema.parse(req.body));
    if ('preview' in result) return res.json(result);
    res.status(result.created ? 201 : 200).json({ ...result, order: await getOrder(shopId, id) });
  }),
);

returnsRouter.get(
  '/returns/:id',
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await getReturn(auth(req).shopId, id));
  }),
);

returnsRouter.get(
  '/returns/:id/pdf',
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const doc = await getReturn(auth(req).shopId, id);
    let pdf: Buffer;
    try {
      pdf = await renderReturnPdf(doc, await logoDataUrl(doc.shop.logoKey));
    } catch (err) {
      console.error('Return PDF failed', err);
      throw new AppError(500, 'RETURN_PDF_FAILED', 'Could not generate the return document. Please try again.');
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${doc.returnNumber}.pdf"`);
    res.setHeader('Content-Length', String(pdf.length));
    res.send(pdf);
  }),
);
