import { Bell } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { dashboardApi, ordersApi } from '../api/endpoints';
import DailySummaryModal from '../components/layout/DailySummaryModal';
import { Sparkline, Stat, StatStrip } from '../components/charts/StatStrip';
import OrdersTable from '../components/orders/OrdersTable';
import { PaymentBadge } from '../components/ui/Badge';
import { ButtonLink } from '../components/ui/Button';
import { SectionHeader } from '../components/ui/Card';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/States';
import { PageTop } from '../components/ui/Tabs';
import { useAuth } from '../context/AuthContext';
import { useDailySummary } from '../lib/dailySummary';
import { relativeDays } from '../lib/date';
import { useAsync } from '../lib/hooks';
import { formatINR, formatINRCompact } from '../lib/money';
import type { AnalyticsDays } from '../types';

const PERIODS: [AnalyticsDays, string][] = [
  [1, 'Today'],
  [7, '7 days'],
  [30, '30 days'],
  [90, '90 days'],
];
const change = (cur: number, prev: number) => (prev ? `${cur >= prev ? '+' : '−'}${Math.abs(((cur - prev) / prev) * 100).toFixed(0)}%` : undefined);

/** Opens the 10 pm daily summary; shows a dot until it's been read. */
function BellButton({ unread, onClick }: { unread: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={unread ? 'Notifications: daily summary ready' : 'Notifications'}
      title="Daily summary"
      className="relative flex h-9 w-9 items-center justify-center rounded-lg text-ink-2 hover:bg-hover hover:text-ink"
    >
      <Bell size={18} strokeWidth={1.6} />
      {unread && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-critical ring-2 ring-surface" />}
    </button>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { shop } = useAuth();
  const [days, setDays] = useState<AnalyticsDays>(1);
  const analytics = useAsync(() => dashboardApi.analytics(days), [days]);
  const recent = useAsync(() => ordersApi.list({ pageSize: 8 }), []);
  const unpaid = useAsync(() => ordersApi.list({ due: 'true', sort: 'date', dir: 'asc', pageSize: 5 }), []);
  const daily = useDailySummary(shop?.id);
  const [summaryOpen, setSummaryOpen] = useState(false);

  const a = analytics.data;
  const s = a?.summary;
  const series = a?.daily ?? [];
  const label = days === 1 ? 'today' : `${days}d`;

  return (
    <>
      <PageTop
        title="Overview"
        actions={
          <>
            <div role="radiogroup" aria-label="Period" className="flex rounded-lg border border-line p-0.5">
              {PERIODS.map(([d, l]) => (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={days === d}
                  onClick={() => setDays(d)}
                  className={`h-7 rounded-md px-2.5 text-[13px] ${days === d ? 'bg-ink text-on-ink' : 'text-ink-2 hover:bg-hover'}`}
                >
                  {l}
                </button>
              ))}
            </div>
            <BellButton
              unread={daily.unread}
              onClick={() => {
                setSummaryOpen(true);
                daily.markSeen();
              }}
            />
            <ButtonLink to="/customers/new" variant="secondary">
              Add customer
            </ButtonLink>
            <ButtonLink to="/orders/new">New order</ButtonLink>
          </>
        }
      />

      {analytics.error ? (
        <ErrorState error={analytics.error} onRetry={analytics.reload} />
      ) : !s ? (
        <LoadingState />
      ) : (
        <StatStrip page="dashboard" dim={analytics.loading}>
          <Stat
            label={`Total sales · ${label}`}
            value={formatINRCompact(s.revenuePaise)}
            suffix={change(s.revenuePaise, s.prevRevenuePaise)}
            trend={s.revenuePaise >= s.prevRevenuePaise ? 'up' : 'down'}
            visual={<Sparkline values={series.map((d) => d.revenuePaise)} label={`Daily sales, last ${days} days`} />}
          />
          <Stat
            label={`Total orders · ${label}`}
            value={String(s.orders)}
            suffix={change(s.orders, s.prevOrders)}
            trend={s.orders >= s.prevOrders ? 'up' : 'down'}
            visual={<Sparkline values={series.map((d) => d.orders)} label={`Daily orders, last ${days} days`} />}
          />
          <Stat label={`Total customers · ${label}`} value={String(s.activeCustomers)} />
        </StatStrip>
      )}

      <div className="grid lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="min-w-0 lg:border-r lg:border-line">
          <SectionHeader
            title="Recent orders"
            actions={
              <ButtonLink to="/orders" variant="ghost" size="sm">
                View all
              </ButtonLink>
            }
          />
          {recent.loading && !recent.data ? (
            <LoadingState />
          ) : recent.error ? (
            <ErrorState error={recent.error} onRetry={recent.reload} />
          ) : recent.data?.data.length ? (
            <OrdersTable orders={recent.data.data} hidden={new Set(['due', 'status'])} />
          ) : (
            <EmptyState title="No orders yet" action={<ButtonLink to="/orders/new">New order</ButtonLink>} />
          )}
        </section>

        <aside className="border-t border-line lg:border-t-0">
          <SectionHeader title="Oldest unpaid orders" />
          {unpaid.data?.data.length ? (
            <ul className="py-1.5">
              {unpaid.data.data.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/orders/${o.id}`)}
                    className="flex h-[52px] w-full items-center gap-3 px-4 text-left hover:bg-wash sm:px-6"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] text-ink">
                        {o.orderNumber} · {o.customerName}
                      </span>
                      <span className="block text-[12.5px] text-ink-3">{relativeDays(o.orderDate)}</span>
                    </span>
                    <PaymentBadge status={o.paymentStatus} />
                    <span className="w-20 text-right text-[13px] tabular-nums text-ink">{formatINR(o.totalPaise - o.amountPaidPaise)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-6 py-6 text-[13px] text-ink-3">{unpaid.loading ? 'Loading…' : 'All orders are paid.'}</p>
          )}
        </aside>
      </div>

      <DailySummaryModal
        open={summaryOpen}
        onClose={() => setSummaryOpen(false)}
        summary={daily.summary}
        loading={daily.loading}
        error={daily.error}
        onRetry={daily.retry}
      />
    </>
  );
}
