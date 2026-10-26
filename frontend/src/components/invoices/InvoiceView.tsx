import { formatDate } from '../../lib/date';
import { formatINR, formatQty } from '../../lib/money';
import type { Invoice } from '../../types';
import { PAYMENT_STATUS_LABEL } from '../ui/Badge';
import ShopLogo from '../ui/ShopLogo';

/** Renders only from the invoice snapshot, never live order data. Mirrors the PDF layout. */
export default function InvoiceView({ invoice }: { invoice: Invoice }) {
  const s = invoice.shopSnapshot;
  const c = invoice.customerSnapshot;
  const o = invoice.orderSnapshot;
  const balance = invoice.totalPaise - invoice.amountPaidPaise;
  const cityLine = [s.city, s.state, s.pincode].filter(Boolean).join(', ');
  const label = 'text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3';

  return (
    <article className="print-plain relative mx-auto max-w-[820px] overflow-hidden rounded-xl border border-line bg-white px-6 py-8 text-[14px] text-ink shadow-soft sm:px-12 sm:py-12">
      {invoice.status !== 'issued' && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="-rotate-12 text-7xl font-semibold uppercase tracking-widest text-ink/[0.05]">
            {invoice.status === 'void' ? 'Void' : 'Superseded'}
          </span>
        </div>
      )}

      <header className="relative flex flex-col gap-6 sm:flex-row sm:justify-between">
        <div className="flex gap-4">
          {/* The logo saved with this invoice when it was issued */}
          {s.logoKey && <ShopLogo logoKey={s.logoKey} name={s.name} size={56} />}
          <div>
          <h2 className="text-[20px] font-semibold">{s.name}</h2>
          <div className="mt-1.5 space-y-0.5 text-[13px] leading-relaxed text-ink-2">
            {s.addressLine1 && <p>{s.addressLine1}</p>}
            {s.addressLine2 && <p>{s.addressLine2}</p>}
            {cityLine && <p>{cityLine}</p>}
            {s.phone && <p>Phone: {s.phone}</p>}
            {s.email && <p>{s.email}</p>}
            {s.gstin && <p>GSTIN: {s.gstin}</p>}
          </div>
          </div>
        </div>
        <div className="sm:text-right">
          <p className="text-[26px] font-normal tracking-[-0.01em]">Invoice{invoice.revision > 1 ? ` · Rev ${invoice.revision}` : ''}</p>
          <dl className="mt-2 grid grid-cols-[auto_auto] gap-x-4 gap-y-1 text-[13px] sm:justify-end">
            <dt className="text-ink-3">Invoice no</dt>
            <dd className="tabular-nums">{invoice.invoiceNumber}</dd>
            <dt className="text-ink-3">Invoice date</dt>
            <dd>{formatDate(invoice.invoiceDate)}</dd>
            <dt className="text-ink-3">Order no</dt>
            <dd>{o.orderNumber}</dd>
            <dt className="text-ink-3">Order date</dt>
            <dd>{formatDate(o.orderDate)}</dd>
          </dl>
        </div>
      </header>

      <hr className="relative my-7 border-line" />

      <section className="relative">
        <p className={label}>Bill to</p>
        <p className="mt-1 text-[15px] font-medium">{c.name}</p>
        <div className="mt-0.5 text-[13px] leading-relaxed text-ink-2">
          <p>{c.phone}</p>
          {c.email && <p>{c.email}</p>}
          {c.address && <p>{c.address}</p>}
        </div>
      </section>

      <div className="relative mt-7 overflow-x-auto">
        <table className="w-full min-w-[520px]">
          <thead>
            <tr className="border-b border-line-strong text-left">
              <th className={`w-8 pb-2.5 pr-3 font-medium ${label}`}>#</th>
              <th className={`px-3 pb-2.5 font-medium ${label}`}>Item</th>
              <th className={`px-3 pb-2.5 text-right font-medium ${label}`}>Qty</th>
              <th className={`px-3 pb-2.5 text-right font-medium ${label}`}>Unit price</th>
              <th className={`pb-2.5 pl-3 text-right font-medium ${label}`}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {invoice.itemsSnapshot.map((it) => (
              <tr key={it.position} className="border-b border-line">
                <td className="py-3 pr-3 text-ink-3">{it.position}</td>
                <td className="px-3 py-3">{it.itemName}</td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {formatQty(it.quantity)}
                </td>
                <td className="px-3 py-3 text-right tabular-nums">{formatINR(it.unitPricePaise)}</td>
                <td className="py-3 pl-3 text-right tabular-nums">{formatINR(it.lineTotalPaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="relative mt-6 flex justify-end">
        <dl className="w-full max-w-xs text-[14px]">
          <Row label="Subtotal" value={formatINR(invoice.subtotalPaise)} />
          {invoice.discountPaise > 0 && <Row label="Discount" value={`− ${formatINR(invoice.discountPaise)}`} />}
          <div className="my-2 flex justify-between border-y border-line-strong py-2.5 text-[16px] font-medium">
            <dt>Total</dt>
            <dd className="tabular-nums">{formatINR(invoice.totalPaise)}</dd>
          </div>
          <Row label="Amount paid" value={formatINR(invoice.amountPaidPaise)} />
          <Row label="Balance due" value={formatINR(balance)} strong />
          <Row label="Payment status" value={PAYMENT_STATUS_LABEL[invoice.paymentStatus]} />
        </dl>
      </section>

      {o.notes && (
        <section className="relative mt-8">
          <p className={label}>Notes</p>
          <p className="mt-1 whitespace-pre-line text-ink-2">{o.notes}</p>
        </section>
      )}

      <footer className="relative mt-12 flex justify-between border-t border-line pt-4 text-[12px] text-ink-3">
        <span>Thank you for your business!</span>
        <span>{invoice.invoiceNumber}</span>
      </footer>
    </article>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 py-1 ${strong ? 'font-medium' : ''}`}>
      <dt className={strong ? '' : 'text-ink-2'}>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
