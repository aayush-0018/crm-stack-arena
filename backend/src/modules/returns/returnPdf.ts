import PdfPrinter from 'pdfmake';
import type { Column, Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';
import { formatRupees } from '../../lib/money';
import { METHOD_LABEL } from '../receipts/receiptPdf';
import { getReturn } from './returns.service';

type ReturnDoc = Awaited<ReturnType<typeof getReturn>>;

// Same fonts and palette as the invoice PDF.
const printer = new PdfPrinter({
  Helvetica: { normal: 'Helvetica', bold: 'Helvetica-Bold', italics: 'Helvetica-Oblique', bolditalics: 'Helvetica-BoldOblique' },
});
const INK = '#171717';
const INK_2 = '#5f5f5c';
const INK_3 = '#8f8f8b';
const LINE = '#e7e7e4';
const LINE_STRONG = '#d4d4d0';

const fmtDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
const lines = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join('\n');
const label = (text: string): Content => ({ text: text.toUpperCase(), style: 'label' });

export function buildReturnDoc(r: ReturnDoc, logo: string | null = null): TDocumentDefinitions {
  const s = r.shop;
  const logoColumn: Column[] = [];
  if (logo) logoColumn.push({ width: 'auto', stack: [{ image: logo, fit: [52, 52] }], margin: [0, 0, 12, 0] });
  const th = (text: string, alignment: 'left' | 'right' = 'left'): TableCell => ({ text: text.toUpperCase(), style: 'th', alignment });
  const itemRows: TableCell[][] = r.items.map((it) => [
    { text: it.itemName },
    { text: String(Number(it.quantity)), alignment: 'right' },
    { text: it.condition === 'damaged' ? 'Damaged' : 'Back in stock', color: it.condition === 'damaged' ? '#b42318' : INK_2 },
    { text: formatRupees(it.valuePaise), alignment: 'right' },
  ]);
  const refunds = r.refunds.filter((p) => !p.voidedAt);
  const totalRow = (name: string, value: string, bold = false): TableCell[] => [
    { text: name, color: bold ? INK : INK_2, bold },
    { text: value, alignment: 'right', bold },
  ];

  const content: Content[] = [
    {
      columns: [
        ...logoColumn,
        {
          width: '*',
          stack: [
            { text: s.name ?? '', style: 'shopName' },
            { text: lines(s.addressLine1, s.addressLine2, [s.city, s.state, s.pincode].filter(Boolean).join(', '), s.phone ? `Phone: ${s.phone}` : null), style: 'muted' },
          ],
        },
        {
          width: 'auto',
          stack: [
            { text: 'Return adjustment', style: 'title', alignment: 'right' },
            {
              alignment: 'right',
              table: {
                body: [
                  ['Return no', r.returnNumber],
                  ['Return date', fmtDate(r.returnDate)],
                  ['Order no', r.orderNumber],
                  ...(r.invoice ? [['Invoice no', r.invoice.invoiceNumber]] : []),
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
      stack: [label('Customer'), { text: r.customer.name, bold: true, fontSize: 11, margin: [0, 2, 0, 2] }, { text: r.customer.phone ?? '', style: 'muted' }],
      margin: [0, 0, 0, 20],
    },
    {
      table: { headerRows: 1, widths: ['*', 50, 90, 90], body: [[th('Item'), th('Qty', 'right'), th('Condition'), th('Value', 'right')], ...itemRows] },
      layout: {
        hLineWidth: (i: number, node: { table: { body: unknown[] } }) => (i === 0 ? 0 : i === 1 || i === node.table.body.length ? 0.8 : 0.5),
        vLineWidth: () => 0,
        hLineColor: (i: number) => (i === 1 ? LINE_STRONG : LINE),
        paddingLeft: (i: number) => (i === 0 ? 0 : 8),
        paddingRight: (i: number) => (i === 3 ? 0 : 8),
        paddingTop: () => 7,
        paddingBottom: () => 7,
      },
    },
    {
      margin: [0, 14, 0, 0],
      columns: [
        { width: '*', text: '' },
        {
          width: 250,
          table: {
            widths: ['*', 'auto'],
            body: [
              totalRow('Value of returned items', formatRupees(r.valuePaise), true),
              totalRow('Refunded', formatRupees(r.refundPaise)),
              ...refunds.map((p) => totalRow(`  ${METHOD_LABEL[p.method] ?? p.method}${p.receiptNumber ? ` · ${p.receiptNumber}` : ''}`, formatRupees(p.amountPaise))),
            ],
          },
          layout: { defaultBorder: false, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 3, paddingBottom: () => 3 },
        },
      ],
    },
  ];
  if (r.reason) content.push({ margin: [0, 20, 0, 0], stack: [label('Reason'), { text: r.reason, color: INK_2, margin: [0, 3, 0, 0] }] });
  content.push({
    margin: [0, 24, 0, 0],
    text: 'Internal return adjustment. The original invoice is unchanged. This is not a GST credit note.',
    style: 'muted',
    color: INK_3,
  });

  return {
    pageSize: 'A4',
    pageMargins: [36, 40, 36, 56],
    info: { title: r.returnNumber },
    defaultStyle: { font: 'Helvetica', fontSize: 10, lineHeight: 1.3, color: INK },
    content,
    footer: (page, pages) => ({
      margin: [36, 16, 36, 0],
      columns: [
        { text: 'Made with CartWell', style: 'muted', color: INK_3 },
        { text: `Page ${page} of ${pages}`, alignment: 'right', style: 'muted' },
      ],
    }),
    styles: {
      shopName: { fontSize: 16, bold: true, margin: [0, 0, 0, 6] },
      title: { fontSize: 18, margin: [0, 0, 0, 8] },
      label: { fontSize: 7.5, bold: true, color: INK_3, characterSpacing: 0.6 },
      muted: { color: INK_2, fontSize: 9 },
      th: { fontSize: 7.5, bold: true, color: INK_3, characterSpacing: 0.6 },
    },
  };
}

export function renderReturnPdf(r: ReturnDoc, logo: string | null = null): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = printer.createPdfKitDocument(buildReturnDoc(r, logo));
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
