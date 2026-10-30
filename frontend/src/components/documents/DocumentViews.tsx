import { ReactNode } from 'react';
import { formatDate } from '../../lib/date';
import { formatINR, formatQty } from '../../lib/money';
import type { Receipt, ReturnDoc, Shop } from '../../types';
import { PAYMENT_METHOD_LABEL } from '../orders/Payments';
import ShopLogo from '../ui/ShopLogo';

const label = 'text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3';

/** The paper: same look as the invoice, and always light (it stands for a printed document). */
function Paper({ watermark, children }: { watermark?: string; children: ReactNode }) {
  return (
    <article className="theme-light print-plain relative mx-auto max-w-[820px] overflow-hidden rounded-xl border border-line bg-surface px-6 py-8 text-[14px] text-ink shadow-soft sm:px-12 sm:py-12">
      {watermark && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="-rotate-12 text-7xl font-semibold uppercase tracking-widest text-ink/[0.05]">{watermark}</span>
        </div>
      )}
      {children}
    </article>
  );
}

function Header({ shop, title, meta }: { shop: Omit<Shop, 'id'>; title: string; meta: [string, ReactNode][] }) {
  const cityLine = [shop.city, shop.state, shop.pincode].filter(Boolean).join(', ');
  return (
    <header className="relative flex flex-col gap-6 sm:flex-row sm:justify-between">
      <div className="flex gap-4">
        {shop.logoKey && <ShopLogo logoKey={shop.logoKey} name={shop.name} size={56} />}
        <div>
          <h2 className="text-[20px] font-semibold">{shop.name}</h2>
          <div className="mt-1.5 space-y-0.5 text-[13px] leading-relaxed text-ink-2">
            {shop.addressLine1 && <p>{shop.addressLine1}</p>}
            {shop.addressLine2 && <p>{shop.addressLine2}</p>}
            {cityLine && <p>{cityLine}</p>}
            {shop.phone && <p>Phone: {shop.phone}</p>}
            {shop.email && <p>{shop.email}</p>}
            {shop.gstin && <p>GSTIN: {shop.gstin}</p>}
          </div>
        </div>
      </div>
      <div className="sm:text-right">
        <p className="text-[26px] font-normal tracking-[-0.01em]">{title}</p>
        <dl className="mt-2 grid grid-cols-[auto_auto] gap-x-4 gap-y-1 text-[13px] sm:justify-end">
          {meta.map(([k, v]) => [
            <dt key={`${k}-k`} className="text-ink-3">
              {k}
            </dt>,
            <dd key={`${k}-v`} className="tabular-nums">
              {v}
            </dd>,
          ])}
        </dl>
      </div>
    </header>
  );
}

/** A payment or refund receipt, rendered only from what was stored when it was issued. Mirrors the PDF. */
export function ReceiptView({ receipt: r }: { receipt: Receipt }) {
  const refund = r.kind === 'refund';
  const cancelled = r.voidedPaise >= r.amountPaise;
  return (
    <Paper watermark={cancelled ? 'Cancelled' : undefined}>
      <Header
        shop={r.shopSnapshot}
        title={refund ? 'Refund receipt' : 'Payment receipt'}
        meta={[
          [refund ? 'Refund no' : 'Receipt no', r.receiptNumber],
          ['Date', formatDate(r.receiptDate)],
          ['Method', PAYMENT_METHOD_LABEL[r.method]],
          ...(r.reference ? ([['Reference', r.reference]] as [string, ReactNode][]) : []),
        ]}
      />
      <hr className="relative my-7 border-line" />
      <section className="relative">
        <p className={label}>{refund ? 'Refunded to' : 'Received from'}</p>
        <p className="mt-1 text-[15px] font-medium">{r.customerSnapshot.name}</p>
        <p className="text-[13px] text-ink-2">{[r.customerSnapshot.phone, r.customerSnapshot.email].filter(Boolean).join(' · ')}</p>
      </section>
      <table className="relative mt-7 w-full text-[14px]">
        <thead>
          <tr className="border-b border-line-strong text-left">
            <th className={`pb-2 font-medium ${label}`}>Order</th>
            <th className={`pb-2 text-right font-medium ${label}`}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {r.allocations.map((a) => (
            <tr key={a.orderId} className="border-b border-line">
              <td className="py-2.5">{a.orderNumber}</td>
              <td className="py-2.5 text-right tabular-nums">{formatINR(a.amountPaise)}</td>
            </tr>
          ))}
          <tr>
            <td className="pt-3 font-semibold">{refund ? 'Total refunded' : 'Total received'}</td>
            <td className="pt-3 text-right font-semibold tabular-nums">{formatINR(r.amountPaise)}</td>
          </tr>
        </tbody>
      </table>
      {r.note && (
        <section className="relative mt-7">
          <p className={label}>Note</p>
          <p className="mt-1 text-ink-2">{r.note}</p>
        </section>
      )}
      {r.voidedPaise > 0 && (
        <p className="relative mt-7 text-[13px] text-danger">
          {cancelled
            ? 'This receipt was cancelled: its entries were removed from the payment history.'
            : `${formatINR(r.voidedPaise)} of this receipt was later removed from the payment history.`}
        </p>
      )}
    </Paper>
  );
}

/** The internal return adjustment document. Mirrors the PDF. */
export function ReturnView({ doc: r }: { doc: ReturnDoc }) {
  const refunds = r.refunds.filter((p) => !p.voidedAt);
  return (
    <Paper>
      <Header
        shop={r.shop}
        title="Return adjustment"
        meta={[
          ['Return no', r.returnNumber],
          ['Return date', formatDate(r.returnDate)],
          ['Order no', r.orderNumber],
          ...(r.invoice ? ([['Invoice no', r.invoice.invoiceNumber]] as [string, ReactNode][]) : []),
        ]}
      />
      <hr className="relative my-7 border-line" />
      <section className="relative">
        <p className={label}>Customer</p>
        <p className="mt-1 text-[15px] font-medium">{r.customer.name}</p>
        {r.customer.phone && <p className="text-[13px] text-ink-2">{r.customer.phone}</p>}
      </section>
      <div className="relative mt-7 overflow-x-auto">
        <table className="w-full min-w-[460px] text-[14px]">
          <thead>
            <tr className="border-b border-line-strong text-left">
              <th className={`pb-2 font-medium ${label}`}>Item</th>
              <th className={`pb-2 text-right font-medium ${label}`}>Qty</th>
              <th className={`pb-2 pl-4 font-medium ${label}`}>Condition</th>
              <th className={`pb-2 text-right font-medium ${label}`}>Value</th>
            </tr>
          </thead>
          <tbody>
            {r.items.map((it, i) => (
              <tr key={i} className="border-b border-line">
                <td className="py-2.5">{it.itemName}</td>
                <td className="py-2.5 text-right tabular-nums">{formatQty(it.quantity)}</td>
                <td className={`py-2.5 pl-4 ${it.condition === 'damaged' ? 'text-danger' : 'text-ink-2'}`}>
                  {it.condition === 'damaged' ? 'Damaged' : 'Back in stock'}
                </td>
                <td className="py-2.5 text-right tabular-nums">{formatINR(it.valuePaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="relative ml-auto mt-5 max-w-xs space-y-1.5 text-[14px]">
        <div className="flex justify-between font-semibold">
          <dt>Value of returned items</dt>
          <dd className="tabular-nums">{formatINR(r.valuePaise)}</dd>
        </div>
        <div className="flex justify-between text-ink-2">
          <dt>Refunded</dt>
          <dd className="tabular-nums">{formatINR(r.refundPaise)}</dd>
        </div>
        {refunds.map((p) => (
          <div key={p.id} className="flex justify-between pl-3 text-[13px] text-ink-3">
            <dt>
              {PAYMENT_METHOD_LABEL[p.method]}
              {p.receiptNumber ? ` · ${p.receiptNumber}` : ''}
            </dt>
            <dd className="tabular-nums">{formatINR(p.amountPaise)}</dd>
          </div>
        ))}
      </dl>
      {r.reason && (
        <section className="relative mt-7">
          <p className={label}>Reason</p>
          <p className="mt-1 text-ink-2">{r.reason}</p>
        </section>
      )}
      <p className="relative mt-8 text-[12px] text-ink-3">Internal return adjustment. The original invoice is unchanged. This is not a GST credit note.</p>
    </Paper>
  );
}
