import PdfPrinter from 'pdfmake';
import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';
import { formatRupees } from '../../lib/money';
import { Invoice } from './invoices.repo';

// PDF standard fonts: built into every PDF reader, no font files to ship.
const printer = new PdfPrinter({
  Helvetica: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique',
  },
});

const PAYMENT_LABEL = { unpaid: 'Unpaid', partial: 'Partially paid', paid: 'Paid' } as const;

// Same neutral palette as the web app.
const INK = '#171717';
const INK_2 = '#5f5f5c';
const INK_3 = '#8f8f8b';
const LINE = '#e7e7e4';
const LINE_STRONG = '#d4d4d0';

const fmtDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

const fmtQty = (q: string) => String(Number(q));

const lines = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join('\n');

const label = (text: string): Content => ({ text: text.toUpperCase(), style: 'label' });

export function buildInvoiceDoc(inv: Invoice): TDocumentDefinitions {
  const s = inv.shopSnapshot;
  const c = inv.customerSnapshot;
  const balance = inv.totalPaise - inv.amountPaidPaise;

  const th = (text: string, alignment: 'left' | 'right' = 'left'): TableCell => ({ text: text.toUpperCase(), style: 'th', alignment });
  const itemRows: TableCell[][] = inv.itemsSnapshot.map((it) => [
    { text: String(it.position), color: INK_3 },
    { text: it.itemName },
    { text: `${fmtQty(it.quantity)}${it.unit ? ` ${it.unit}` : ''}`, alignment: 'right' },
    { text: formatRupees(it.unitPricePaise), alignment: 'right' },
    { text: formatRupees(it.lineTotalPaise), alignment: 'right' },
  ]);

  const totalRow = (name: string, value: string, opts: { bold?: boolean; big?: boolean } = {}): TableCell[] => [
    { text: name, color: opts.bold ? INK : INK_2, bold: opts.bold, fontSize: opts.big ? 12 : 10 },
    { text: value, alignment: 'right', bold: opts.bold, fontSize: opts.big ? 12 : 10 },
  ];
  const totals: TableCell[][] = [
    totalRow('Subtotal', formatRupees(inv.subtotalPaise)),
    ...(inv.discountPaise > 0 ? [totalRow('Discount', `- ${formatRupees(inv.discountPaise)}`)] : []),
    totalRow('Total', formatRupees(inv.totalPaise), { bold: true, big: true }),
    totalRow('Amount paid', formatRupees(inv.amountPaidPaise)),
    totalRow('Balance due', formatRupees(balance), { bold: true }),
    totalRow('Payment status', PAYMENT_LABEL[inv.paymentStatus]),
  ];
  const totalIdx = inv.discountPaise > 0 ? 2 : 1; // row index of "Total"

  const content: Content[] = [
    {
      columns: [
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
            { text: inv.revision > 1 ? `Invoice · Rev ${inv.revision}` : 'Invoice', style: 'title', alignment: 'right' },
            {
              alignment: 'right',
              table: {
                body: [
                  ['Invoice no', inv.invoiceNumber],
                  ['Invoice date', fmtDate(inv.invoiceDate)],
                  ['Order no', inv.orderSnapshot.orderNumber],
                  ['Order date', fmtDate(inv.orderSnapshot.orderDate)],
                ].map(([k, v]) => [
                  { text: k, color: INK_3, alignment: 'right' },
                  { text: v, alignment: 'right' },
                ]),
              },
              layout: {
                defaultBorder: false,
                paddingLeft: () => 8,
                paddingRight: () => 0,
                paddingTop: () => 1.5,
                paddingBottom: () => 1.5,
              },
            },
          ],
        },
      ],
    },
    { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 523, y2: 0, lineWidth: 0.6, lineColor: LINE }], margin: [0, 20, 0, 16] },
    {
      stack: [
        label('Bill to'),
        { text: c.name, bold: true, fontSize: 11, margin: [0, 2, 0, 2] },
        { text: lines(c.phone, c.email, c.address), style: 'muted' },
      ],
      margin: [0, 0, 0, 20],
    },
    {
      table: {
        headerRows: 1,
        dontBreakRows: true,
        widths: [20, '*', 64, 80, 84],
        body: [[th('#'), th('Item'), th('Qty', 'right'), th('Unit price', 'right'), th('Amount', 'right')], ...itemRows],
      },
      layout: {
        hLineWidth: (i: number, node: { table: { body: unknown[] } }) =>
          i === 0 ? 0 : i === 1 || i === node.table.body.length ? 0.8 : 0.5,
        vLineWidth: () => 0,
        hLineColor: (i: number) => (i === 1 ? LINE_STRONG : LINE),
        paddingLeft: (i: number) => (i === 0 ? 0 : 8),
        paddingRight: (i: number) => (i === 4 ? 0 : 8), // last of the 5 columns
        paddingTop: (i: number) => (i === 0 ? 0 : 8),
        paddingBottom: (i: number) => (i === 0 ? 6 : 8),
      },
    },
    {
      margin: [0, 16, 0, 0],
      columns: [
        { width: '*', text: '' },
        {
          width: 230,
          table: { widths: ['*', 'auto'], body: totals },
          layout: {
            hLineWidth: (i: number) => (i === totalIdx ? 0.8 : 0),
            vLineWidth: () => 0,
            hLineColor: () => LINE_STRONG,
            paddingLeft: () => 0,
            paddingRight: () => 0,
            paddingTop: (i: number) => (i === totalIdx ? 8 : 3),
            paddingBottom: (i: number) => (i === totalIdx ? 8 : 3),
          },
        },
      ],
    },
  ];

  if (inv.orderSnapshot.notes) {
    content.push({
      margin: [0, 24, 0, 0],
      stack: [label('Notes'), { text: inv.orderSnapshot.notes, color: INK_2, margin: [0, 3, 0, 0] }],
    });
  }

  return {
    pageSize: 'A4',
    pageMargins: [36, 40, 36, 56],
    info: { title: inv.invoiceNumber },
    defaultStyle: { font: 'Helvetica', fontSize: 10, lineHeight: 1.3, color: INK },
    watermark:
      inv.status === 'issued'
        ? undefined
        : { text: inv.status === 'void' ? 'VOID' : 'SUPERSEDED', opacity: 0.08, bold: true },
    content,
    footer: (page, pages) => ({
      margin: [36, 16, 36, 0],
      columns: [
        { text: 'Thank you for your business!', style: 'muted' },
        { text: `Page ${page} of ${pages}`, alignment: 'right', style: 'muted' },
      ],
    }),
    styles: {
      shopName: { fontSize: 16, bold: true, margin: [0, 0, 0, 6] },
      title: { fontSize: 20, margin: [0, 0, 0, 8] },
      label: { fontSize: 7.5, bold: true, color: INK_3, characterSpacing: 0.6 },
      muted: { color: INK_2, fontSize: 9 },
      th: { fontSize: 7.5, bold: true, color: INK_3, characterSpacing: 0.6 },
    },
  };
}

export function renderInvoicePdf(inv: Invoice): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = printer.createPdfKitDocument(buildInvoiceDoc(inv));
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
