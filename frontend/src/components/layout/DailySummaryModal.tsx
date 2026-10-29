import { ArrowDownRight, ArrowUpRight, Eye, EyeOff, Moon, X } from 'lucide-react';
import { ReactNode, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { usePageNumbers } from '../../context/PrivacyContext';
import { formatINR, formatINRCompact } from '../../lib/money';
import type { DailySummary } from '../../types';
import Button from '../ui/Button';
import Spinner from '../ui/Spinner';

const dayFmt = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const shortDay = new Intl.DateTimeFormat('en-IN', { weekday: 'short', timeZone: 'Asia/Kolkata' });

/** 10 -> "10–11 am", 11 -> "11 am–12 pm", 23 -> "11 pm–12 am" */
const hourLabel = (h: number) => {
  const num = (x: number) => (x % 12 === 0 ? 12 : x % 12);
  const mer = (x: number) => (x % 24 < 12 ? 'am' : 'pm');
  return mer(h) === mer(h + 1) ? `${num(h)}–${num(h + 1)} ${mer(h)}` : `${num(h)} ${mer(h)}–${num(h + 1)} ${mer(h + 1)}`;
};

/** The big end-of-day dialog behind the bell. */
export default function DailySummaryModal({
  open,
  onClose,
  summary,
  loading,
  error,
  onRetry,
}: {
  open: boolean;
  onClose: () => void;
  summary: DailySummary | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const { hideNumbers, toggleHideNumbers } = usePageNumbers('summary');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const s = summary;
  const hide = (v: string) => (hideNumbers ? '••••' : v);

  return (
    <div className="no-print fixed inset-0 z-50 flex items-end justify-center bg-ink/25 p-0 sm:items-center sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Daily summary"
        className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-t-2xl border border-line bg-white shadow-pop sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sticky top-0 z-10 flex items-start gap-3 border-b border-line bg-white px-5 py-4 sm:px-7">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#171717] text-white">
            <Moon size={17} strokeWidth={1.8} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[17px] font-semibold text-ink">Daily summary</h2>
            {s && (
              <p className="text-[13px] text-ink-3">
                {dayFmt.format(new Date(`${s.date}T00:00:00Z`))} · 10 pm {shortDay.format(new Date(s.from))} → 10 pm {shortDay.format(new Date(s.to))}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={toggleHideNumbers}
            aria-label={hideNumbers ? 'Show numbers' : 'Hide numbers'}
            title={hideNumbers ? 'Show numbers' : 'Hide numbers'}
            className="rounded-lg p-2 text-ink-3 hover:bg-hover hover:text-ink"
          >
            {hideNumbers ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-2 text-ink-3 hover:bg-hover hover:text-ink">
            <X size={18} />
          </button>
        </header>

        {!s ? (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center text-[14px] text-ink-3">
            {loading ? (
              <>
                <Spinner className="h-5 w-5" /> Preparing your summary…
              </>
            ) : error ? (
              <>
                <p>{error}</p>
                <Button variant="secondary" size="sm" onClick={onRetry}>
                  Retry
                </Button>
              </>
            ) : (
              <p>Your first summary arrives at 10 pm.</p>
            )}
          </div>
        ) : (
          <div className="space-y-6 px-5 py-6 sm:px-7">
            {/* Hero */}
            <section className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-[13.5px] text-ink-2">Sales</p>
                <p className="mt-1 text-[44px] font-normal leading-none tracking-[-0.03em] text-ink sm:text-[52px]">
                  {hide(formatINR(s.revenuePaise).replace(/\.00$/, ''))}
                </p>
              </div>
              {!hideNumbers && <Delta now={s.revenuePaise} before={s.prevRevenuePaise} />}
            </section>

            {s.orders === 0 && s.cancelled === 0 ? (
              <p className="rounded-xl border border-line bg-[#fafaf8] px-4 py-5 text-[14px] text-ink-2">
                No orders were entered in this window. Quiet day — or the shop was closed.
              </p>
            ) : (
              <>
                <section className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4">
                  <Tile label="Total orders" value={hide(String(s.orders))} foot={hideNumbers ? undefined : `${s.prevOrders} the day before`} />
                  <Tile
                    label="Payments received"
                    value={hide(formatINRCompact(s.collectedPaise))}
                    foot={hideNumbers || !s.revenuePaise ? undefined : `${Math.round((s.collectedPaise / s.revenuePaise) * 100)}% of sales`}
                  />
                  <Tile
                    label="Still due"
                    value={hide(formatINRCompact(s.revenuePaise - s.collectedPaise))}
                    foot={hideNumbers ? undefined : `${s.unpaidOrders} order${s.unpaidOrders === 1 ? '' : 's'} not fully paid`}
                  />
                  <Tile label="Items sold" value={hide(String(Number(s.unitsSold.toFixed(3))))} foot={hideNumbers ? undefined : `across ${s.itemLines} lines`} />
                </section>

                <section className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                  <Fact label="New customers" value={hide(String(s.newCustomers))} />
                  <Fact label="Invoices issued" value={hide(String(s.invoicesIssued))} />
                  <Fact label="Invoices sent" value={hide(String(s.invoicesSent))} />
                  <Fact label="Cancelled orders" value={hide(String(s.cancelled))} />
                  <Fact label="Busiest hour" value={s.busiestHour ? `${hourLabel(s.busiestHour.hour)}` : '—'} />
                  <Fact label="Orders that hour" value={hide(s.busiestHour ? String(s.busiestHour.orders) : '—')} />
                </section>

                <section className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-xl border border-line p-4">
                    <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3">Best-selling items</p>
                    {s.topItems.length ? (
                      <ol className="space-y-2">
                        {s.topItems.map((it, i) => (
                          <li key={it.name} className="flex items-baseline gap-3 text-[14px]">
                            <span className="w-4 text-ink-3">{i + 1}</span>
                            <span className="min-w-0 flex-1 truncate text-ink">{it.name}</span>
                            <span className="text-[12.5px] text-ink-3">{hide(`× ${Number(it.units.toFixed(3))}`)}</span>
                            <span className="w-20 text-right tabular-nums text-ink">{hide(formatINRCompact(it.revenuePaise))}</span>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="text-[13px] text-ink-3">—</p>
                    )}
                  </div>
                  <div className="rounded-xl border border-line p-4">
                    <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3">Best customer</p>
                    {s.topCustomer ? (
                      <Link to={`/customers/${s.topCustomer.id}`} onClick={onClose} className="block rounded-lg hover:bg-[#fafaf8]">
                        <p className="text-[15px] text-ink">{s.topCustomer.name}</p>
                        <p className="text-[13px] text-ink-3">
                          {hide(formatINR(s.topCustomer.spentPaise))} · {hide(String(s.topCustomer.orders))} order{s.topCustomer.orders === 1 ? '' : 's'}
                        </p>
                      </Link>
                    ) : (
                      <p className="text-[13px] text-ink-3">—</p>
                    )}
                  </div>
                </section>
              </>
            )}

            <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#fafaf8] px-4 py-3.5">
              <p className="text-[13.5px] text-ink-2">
                Payments pending across the shop:{' '}
                <span className="text-ink">{hide(formatINR(s.outstanding.duePaise))}</span>{' '}
                {!hideNumbers && <span className="text-ink-3">on {s.outstanding.dueOrders} orders</span>}
              </p>
              <Link to="/orders?paymentStatus=unpaid" onClick={onClose} className="text-[13.5px] text-ink underline-offset-2 hover:underline">
                See unpaid orders →
              </Link>
            </section>

            <p className="text-center text-[12px] text-ink-3">
              Next summary at 10 pm. This one is kept only on this device and is replaced then.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Delta({ now, before }: { now: number; before: number }) {
  if (!before) return <span className="text-[13px] text-ink-3">No sales the day before</span>;
  const pct = ((now - before) / before) * 100;
  const up = pct >= 0;
  return (
    <span className="flex items-center gap-1 text-[14px]" style={{ color: up ? 'var(--delta-up)' : 'var(--delta-down)' }}>
      {up ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
      {Math.abs(pct).toFixed(0)}% <span className="text-ink-3">vs the day before</span>
    </span>
  );
}

function Tile({ label, value, foot }: { label: string; value: string; foot?: ReactNode }) {
  return (
    <div className="bg-white px-4 py-3.5">
      <p className="text-[13px] text-ink-2">{label}</p>
      <p className="mt-1.5 text-[24px] leading-none tracking-[-0.02em] text-ink">{value}</p>
      {foot && <p className="mt-1.5 text-[12px] text-ink-3">{foot}</p>}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line pb-2 text-[14px]">
      <span className="text-ink-2">{label}</span>
      <span className="whitespace-nowrap tabular-nums text-ink">{value}</span>
    </div>
  );
}
