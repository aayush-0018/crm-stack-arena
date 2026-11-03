import { Bell } from 'lucide-react';
import { useState } from 'react';
import { dashboardApi, ordersApi } from '../api/endpoints';
import DailySummaryModal from '../components/layout/DailySummaryModal';
import { Sparkline, Stat, StatStrip } from '../components/charts/StatStrip';
import OrdersTable from '../components/orders/OrdersTable';
import { ButtonLink } from '../components/ui/Button';
import { SectionHeader } from '../components/ui/Card';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/States';
import { PageTop } from '../components/ui/Tabs';
import { useAuth } from '../context/AuthContext';
import { useDailySummary } from '../lib/dailySummary';
import { useAsync } from '../lib/hooks';
import { formatINRCompact } from '../lib/money';
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
  const { shop } = useAuth();
  const [days, setDays] = useState<AnalyticsDays>(1);
  const analytics = useAsync(() => dashboardApi.analytics(days), [days]);
  const recent = useAsync(() => ordersApi.list({ pageSize: 8 }), []);
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
        <StatStrip page="dashboard" dim={analytics.loading} even={3}>
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

      <div>
        <section className="min-w-0">
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
