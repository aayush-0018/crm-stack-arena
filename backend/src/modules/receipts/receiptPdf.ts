import PdfPrinter from 'pdfmake';
import type { Column, Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';
import { formatRupees } from '../../lib/money';
import { Receipt } from './receipts.service';

// Same fonts and palette as the invoice PDF.
const printer = new PdfPrinter({
  Helvetica: { normal: 'Helvetica', bold: 'Helvetica-Bold', italics: 'Helvetica-Oblique', bolditalics: 'Helvetica-BoldOblique' },
});
const INK = '#171717';
const INK_2 = '#5f5f5c';
const INK_3 = '#8f8f8b';
const LINE = '#e7e7e4';
const LINE_STRONG = '#d4d4d0';

export const METHOD_LABEL: Record<string, string> = {
  cash: 'Cash',
  upi: 'UPI',
  card: 'Card',
  bank: 'Bank transfer',
  other: 'Other',
  unrecorded: 'Not recorded',
};

const fmtDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
const lines = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join('\n');
const label = (text: string): Content => ({ text: text.toUpperCase(), style: 'label' });

export function buildReceiptDoc(r: Receipt, logo: string | null = null): TDocumentDefinitions {
  const s = r.shopSnapshot;
  const c = r.customerSnapshot;
  const refund = r.kind === 'refund';
  const cancelled = r.voidedPaise >= r.amountPaise;

  const logoColumn: Column[] = [];
  if (logo) logoColumn.push({ width: 'auto', stack: [{ image: logo, fit: [52, 52] }], margin: [0, 0, 12, 0] });

  const th = (text: string, alignment: 'left' | 'right' = 'left'): TableCell => ({ text: text.toUpperCase(), style: 'th', alignment });
  const rows: TableCell[][] = r.allocations.map((a) => [{ text: a.orderNumber }, { text: formatRupees(a.amountPaise), alignment: 'right' }]);
  rows.push([{ text: refund ? 'Total refunded' : 'Total received', bold: true }, { text: formatRupees(r.amountPaise), bold: true, alignment: 'right' }]);

  const content: Content[] = [
    {
      columns: [
        ...logoColumn,
        {
          width: '*',
          stack: [
            { text: s.name ?? '', style: 'shopName' },
            {
              text: lines(
                s.addressLine1,
                s.addressLine2,
                [s.city, s.state, s.pincode].filter(Boolean).join(', '),
                s.phone ? `Phone: ${s.phone}` : null,
                s.email,
                s.gstin ? `GSTIN: ${s.gstin}` : null,
              ),
              style: 'muted',
            },
          ],
        },
        {
          width: 'auto',
          stack: [
            { text: refund ? 'Refund receipt' : 'Payment receipt', style: 'title', alignment: 'right' },
            {
              alignment: 'right',
              table: {
                body: [
                  [refund ? 'Refund no' : 'Receipt no', r.receiptNumber],
                  ['Date', fmtDate(r.receiptDate)],
                  ['Method', METHOD_LABEL[r.method] ?? r.method],
                  ...(r.reference ? [['Reference', r.reference]] : []),
                ].map(([k, v]) => [
                  { text: k, color: INK_3, alignment: 'right' },
                  { text: v, alignment: 'right' },
                ]),
              },
              layout: { defaultBorder: false, paddingLeft: () => 8, paddingRight: () => 0, paddingTop: () => 1.5, paddingBottom: () => 1.5 },
            },
          ],
        },
      ],
    },
    { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 523, y2: 0, lineWidth: 0.6, lineColor: LINE }], margin: [0, 20, 0, 16] },
    {
      stack: [
        label(refund ? 'Refunded to' : 'Received from'),
        { text: c.name, bold: true, fontSize: 11, margin: [0, 2, 0, 2] },
        { text: lines(c.phone, c.email), style: 'muted' },
      ],
      margin: [0, 0, 0, 20],
    },
    {
      table: { headerRows: 1, widths: ['*', 120], body: [[th('Order'), th('Amount', 'right')], ...rows] },
      layout: {
        hLineWidth: (i: number, node: { table: { body: unknown[] } }) => (i === 0 ? 0 : i === 1 || i === node.table.body.length - 1 ? 0.8 : 0.5),
        vLineWidth: () => 0,
        hLineColor: (i: number) => (i === 1 ? LINE_STRONG : LINE),
        paddingLeft: (i: number) => (i === 0 ? 0 : 8),
        paddingRight: (i: number) => (i === 1 ? 0 : 8),
        paddingTop: () => 7,
        paddingBottom: () => 7,
      },
    },
  ];
  if (r.note) content.push({ margin: [0, 20, 0, 0], stack: [label('Note'), { text: r.note, color: INK_2, margin: [0, 3, 0, 0] }] });
  if (r.voidedPaise > 0) {
    content.push({
      margin: [0, 20, 0, 0],
      text: cancelled
        ? 'This receipt was cancelled: its entries were removed from the payment history.'
        : `${formatRupees(r.voidedPaise)} of this receipt was later removed from the payment history.`,
      color: '#b42318',
      fontSize: 9,
    });
  }

  return {
    pageSize: 'A5',
    pageOrientation: 'landscape',
    pageMargins: [36, 36, 36, 48],
    info: { title: r.receiptNumber },
    defaultStyle: { font: 'Helvetica', fontSize: 10, lineHeight: 1.3, color: INK },
    watermark: cancelled ? { text: 'CANCELLED', opacity: 0.08, bold: true } : { text: 'CartWell', opacity: 0.04, bold: true, fontSize: 72 },
    content,
    footer: (page, pages) => ({
      margin: [36, 14, 36, 0],
      columns: [
        { text: refund ? 'Refund issued.' : 'Thank you for your payment!', style: 'muted' },
        { text: 'Made with CartWell', alignment: 'center', style: 'muted', color: INK_3 },
        { text: `Page ${page} of ${pages}`, alignment: 'right', style: 'muted' },
      ],
    }),
    styles: {
      shopName: { fontSize: 15, bold: true, margin: [0, 0, 0, 6] },
      title: { fontSize: 17, margin: [0, 0, 0, 8] },
      label: { fontSize: 7.5, bold: true, color: INK_3, characterSpacing: 0.6 },
      muted: { color: INK_2, fontSize: 9 },
      th: { fontSize: 7.5, bold: true, color: INK_3, characterSpacing: 0.6 },
    },
  };
}

export function renderReceiptPdf(r: Receipt, logo: string | null = null): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = printer.createPdfKitDocument(buildReceiptDoc(r, logo));
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
