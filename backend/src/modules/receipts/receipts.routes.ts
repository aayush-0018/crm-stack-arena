import { Router } from 'express';
import { ah } from '../../lib/asyncHandler';
import { AppError } from '../../lib/errors';
import { idParam } from '../../lib/validation';
import { auth } from '../../middleware/auth';
import { logoDataUrl } from '../shop/logo';
import { renderReceiptPdf } from './receiptPdf';
import { getReceipt } from './receipts.service';

export const receiptsRouter = Router();

receiptsRouter.get(
  '/:id',
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    res.json(await getReceipt(auth(req).shopId, id));
  }),
);

/** Reprints always carry the number and details stored when the receipt was issued. */
receiptsRouter.get(
  '/:id/pdf',
  ah(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const receipt = await getReceipt(auth(req).shopId, id);
    let pdf: Buffer;
    try {
      pdf = await renderReceiptPdf(receipt, await logoDataUrl(receipt.shopSnapshot.logoKey));
    } catch (err) {
      console.error('Receipt PDF failed', err);
      throw new AppError(500, 'RECEIPT_PDF_FAILED', 'Could not generate the receipt PDF. Please try again.');
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${receipt.receiptNumber}.pdf"`);
    res.setHeader('Content-Length', String(pdf.length));
    res.send(pdf);
  }),
);
