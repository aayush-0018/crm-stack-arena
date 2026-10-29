import { useNavigate } from 'react-router-dom';
import { customersApi, dashboardApi, ordersApi } from '../api/endpoints';
import { Sparkline, Stat, StatStrip, TickGauge } from '../components/charts/StatStrip';
import CustomerHoverCard from '../components/customers/CustomerHoverCard';
import OrdersTable from '../components/orders/OrdersTable';
import Avatar from '../components/ui/Avatar';
import { PaymentBadge } from '../components/ui/Badge';
import { ButtonLink } from '../components/ui/Button';
import { SectionHeader } from '../components/ui/Card';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/States';
import { PageTop } from '../components/ui/Tabs';
import { relativeDays } from '../lib/date';
import { useAsync } from '../lib/hooks';
import { formatINR, formatINRCompact } from '../lib/money';

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const change = (cur: number, prev: number) => (prev ? `${cur >= prev ? '+' : '−'}${Math.abs(((cur - prev) / prev) * 100).toFixed(0)}%` : undefined);

export default function DashboardPage() {
  const navigate = useNavigate();
  const analytics = useAsync(() => dashboardApi.analytics(30), []);
  const customers = useAsync(() => customersApi.summary(), []);
  const recent = useAsync(() => ordersApi.list({ pageSize: 8 }), []);
  const forgotten = useAsync(() => customersApi.list({ segment: 'forgotten', sort: 'spent', dir: 'desc', pageSize: 5 }), []);
  const unpaid = useAsync(() => ordersApi.list({ paymentStatus: 'unpaid', sort: 'date', dir: 'asc', pageSize: 5 }), []);

  const a = analytics.data;
  const s = a?.summary;
  const c = customers.data;
  const daily = a?.daily ?? [];
  // 7-day rolling average order value
  const aov = daily.map((_, i) => {
    const w = daily.slice(Math.max(0, i - 6), i + 1);
    const orders = w.reduce((t, d) => t + d.orders, 0);
    return orders ? w.reduce((t, d) => t + d.revenuePaise, 0) / orders : 0;
  });

  return (
    <>
      <PageTop
        title="Overview"
        actions={
          <>
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
        <StatStrip page="dashboard">
          <Stat
            label="Total sales · 30d"
            value={formatINRCompact(s.revenuePaise)}
            suffix={change(s.revenuePaise, s.prevRevenuePaise)}
            trend={s.revenuePaise >= s.prevRevenuePaise ? 'up' : 'down'}
            visual={<Sparkline values={daily.map((d) => d.revenuePaise)} label="Daily sales, last 30 days" />}
          />
          <Stat
            label="Total orders · 30d"
            value={String(s.orders)}
            suffix={change(s.orders, s.prevOrders)}
            trend={s.orders >= s.prevOrders ? 'up' : 'down'}
            visual={<Sparkline values={daily.map((d) => d.orders)} label="Daily orders, last 30 days" />}
          />
          <Stat
            label="Average bill value"
            value={formatINR(s.orders ? Math.round(s.revenuePaise / s.orders) : 0).replace(/\.\d+$/, '')}
            suffix="7d rolling"
            visual={<Sparkline values={aov} label="Average order value, 7-day rolling" />}
          />
          <Stat
            label="Collection rate"
            value={`${pct(s.collectedPaise, s.revenuePaise)}%`}
            suffix={`${formatINRCompact(s.outstandingPaise)} due`}
            visual={<TickGauge value={s.revenuePaise ? s.collectedPaise / s.revenuePaise : 0} reference={0.9} label="Share of revenue collected; target 90%" />}
          />
          <Stat
            label="Active customers"
            value={String(c?.active ?? '—')}
            suffix={c ? `${pct(c.active, c.total)}%` : undefined}
            visual={c && <TickGauge value={c.total ? c.active / c.total : 0} label="Customers who ordered in the last 60 days" />}
          />
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
          <SectionHeader title="Customers to win back" />
          {forgotten.data?.data.length ? (
            <ul className="py-1.5">
              {forgotten.data.data.map((cu) => (
                <li key={cu.id}>
                  <div
                    role="link"
                    tabIndex={0}
                    onClick={() => navigate(`/customers/${cu.id}`)}
                    onKeyDown={(e) => e.key === 'Enter' && navigate(`/customers/${cu.id}`)}
                    className="flex h-[52px] w-full cursor-pointer items-center gap-3 px-4 text-left hover:bg-[#fafaf8] sm:px-6"
                  >
                    <Avatar name={cu.name} />
                    <span className="min-w-0 flex-1">
                      <CustomerHoverCard customerId={cu.id} customer={cu}>
                        <span className="block truncate text-[14px] text-ink">{cu.name}</span>
                      </CustomerHoverCard>
                      <span className="block text-[12.5px] text-ink-3">Last order {relativeDays(cu.lastOrderDate).toLowerCase()}</span>
                    </span>
                    <span className="text-[13px] tabular-nums text-ink-2">{formatINRCompact(cu.totalSpentPaise ?? 0)}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-6 py-6 text-[13px] text-ink-3">{forgotten.loading ? 'Loading…' : 'No forgotten customers. Nice!'}</p>
          )}

          <SectionHeader title="Oldest unpaid orders" className="border-t" />
          {unpaid.data?.data.length ? (
            <ul className="py-1.5">
              {unpaid.data.data.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/orders/${o.id}`)}
                    className="flex h-[52px] w-full items-center gap-3 px-4 text-left hover:bg-[#fafaf8] sm:px-6"
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
    </>
  );
}
