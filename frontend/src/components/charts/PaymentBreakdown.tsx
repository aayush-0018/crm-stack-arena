import { formatINRCompact } from '../../lib/money';
import type { PaymentStatus } from '../../types';

const META: Record<PaymentStatus, { label: string; color: string; icon: string }> = {
  paid: { label: 'Paid', color: 'var(--status-good)', icon: '✓' },
  partial: { label: 'Partial', color: 'var(--status-warning)', icon: '◐' },
  unpaid: { label: 'Unpaid', color: 'var(--status-critical)', icon: '!' },
};
const ORDER: PaymentStatus[] = ['paid', 'partial', 'unpaid'];

/** 100% stacked bar of orders by payment state, with a labelled legend carrying counts and dues. */
export default function PaymentBreakdown({ rows }: { rows: { status: PaymentStatus; orders: number; duePaise: number }[] }) {
  const byStatus = new Map(rows.map((r) => [r.status, r]));
  const data = ORDER.map((s) => ({ status: s, orders: byStatus.get(s)?.orders ?? 0, duePaise: byStatus.get(s)?.duePaise ?? 0 }));
  const total = data.reduce((s, d) => s + d.orders, 0);
  if (!total) return <p className="text-[13px] text-ink-3">No orders in this period.</p>;
  const visible = data.filter((d) => d.orders > 0);

  return (
    <div>
      <div className="flex h-2.5 w-full gap-[2px]" role="img" aria-label={data.map((d) => `${META[d.status].label}: ${d.orders} orders`).join(', ')}>
        {visible.map((d, i) => (
          <div
            key={d.status}
            title={`${META[d.status].label}: ${d.orders} orders (${Math.round((d.orders / total) * 100)}%)`}
            className={`h-full transition-opacity hover:opacity-80 ${i === 0 ? 'rounded-l-[3px]' : ''} ${i === visible.length - 1 ? 'rounded-r-[3px]' : ''}`}
            style={{ width: `${(d.orders / total) * 100}%`, background: META[d.status].color }}
          />
        ))}
      </div>
      <ul className="mt-4 space-y-2.5 text-[14px]">
        {data.map((d) => (
          <li key={d.status} className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
              style={{ background: META[d.status].color }}
            >
              {META[d.status].icon}
            </span>
            <span className="min-w-0 flex-1 truncate text-ink-2">{META[d.status].label}</span>
            <span className="whitespace-nowrap tabular-nums text-ink">
              <span>{d.orders}</span>
              <span className="text-ink-3"> · {Math.round((d.orders / total) * 100)}%</span>
            </span>
            <span className="w-20 whitespace-nowrap text-right tabular-nums text-ink-2" title={d.duePaise ? 'Amount due' : undefined}>
              {d.duePaise ? `${formatINRCompact(d.duePaise)} due` : '—'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
