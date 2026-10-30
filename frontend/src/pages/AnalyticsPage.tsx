import { useState } from 'react';
import { Link } from 'react-router-dom';
import { dashboardApi } from '../api/endpoints';
import BarList from '../components/charts/BarList';
import PaymentBreakdown from '../components/charts/PaymentBreakdown';
import { Sparkline, Stat, StatStrip, TickGauge } from '../components/charts/StatStrip';
import TrendChart from '../components/charts/TrendChart';
import { ORDER_STATUS_LABEL } from '../components/ui/Badge';
import { SectionHeader } from '../components/ui/Card';
import { ErrorState, LoadingState } from '../components/ui/States';
import { PageTop } from '../components/ui/Tabs';
import { useAsync } from '../lib/hooks';
import { formatINR, formatINRCompact } from '../lib/money';
import type { AnalyticsDays, OrderStatus } from '../types';

const PERIODS: AnalyticsDays[] = [7, 30, 90, 180];
type Metric = 'revenue' | 'orders';

const change = (cur: number, prev: number) => (prev ? `${cur >= prev ? '+' : '−'}${Math.abs(((cur - prev) / prev) * 100).toFixed(1)}%` : 'no prior data');

export default function AnalyticsPage() {
  const [days, setDays] = useState<AnalyticsDays>(30);
  const [metric, setMetric] = useState<Metric>('revenue');
  const [showTable, setShowTable] = useState(false);
  const a = useAsync(() => dashboardApi.analytics(days), [days]);

  const top = (
    <PageTop
      tabs={PERIODS.map((d) => ({ key: String(d), label: `Last ${d} days` }))}
      value={String(days)}
      onChange={(k) => setDays(Number(k) as AnalyticsDays)}
    />
  );

  if (!a.data) {
    return (
      <>
        {top}
        {a.error ? <ErrorState error={a.error} onRetry={a.reload} /> : <LoadingState label="Loading analytics…" />}
      </>
    );
  }

  const d = a.data;
  const s = d.summary;
  const statusCounts = new Map(d.status.map((r) => [r.status, r.orders]));
  const trend = d.daily.map((p) => ({ date: p.date, value: metric === 'revenue' ? p.revenuePaise : p.orders }));

  return (
    <>
      {top}
      <StatStrip page="analytics" dim={a.loading}>
        <Stat
          label="Total sales"
          value={formatINRCompact(s.revenuePaise)}
          suffix={change(s.revenuePaise, s.prevRevenuePaise)}
          trend={s.revenuePaise >= s.prevRevenuePaise ? 'up' : 'down'}
          visual={<Sparkline values={d.daily.map((x) => x.revenuePaise)} label="Daily sales" />}
        />
        <Stat
          label="Total orders"
          value={String(s.orders)}
          suffix={change(s.orders, s.prevOrders)}
          trend={s.orders >= s.prevOrders ? 'up' : 'down'}
          visual={<Sparkline values={d.daily.map((x) => x.orders)} label="Daily orders" />}
        />
        <Stat
          label="Average bill value"
          value={formatINR(s.orders ? Math.round(s.revenuePaise / s.orders) : 0).replace(/\.\d+$/, '')}
          suffix={`${s.activeCustomers} buyers`}
        />
        <Stat
          label="Payments received"
          value={formatINRCompact(s.receivedPaise)}
          suffix={change(s.receivedPaise, s.prevReceivedPaise)}
          trend={s.receivedPaise >= s.prevReceivedPaise ? 'up' : 'down'}
          visual={<Sparkline values={d.daily.map((x) => x.receivedPaise)} label="Money received per day by payment date, after refunds" />}
        />
        <Stat
          label="Payments pending"
          value={formatINRCompact(s.outstandingPaise)}
          suffix={s.revenuePaise ? `${Math.round((s.outstandingPaise / s.revenuePaise) * 100)}%` : undefined}
          visual={<TickGauge value={s.revenuePaise ? s.outstandingPaise / s.revenuePaise : 0} label="Share of revenue still due" />}
        />
      </StatStrip>

      <section className={`border-b border-line transition-opacity ${a.loading ? 'opacity-50' : ''}`}>
        <SectionHeader
          title={metric === 'revenue' ? 'Daily sales' : 'Daily orders'}
          className="border-b-0"
          actions={
            <div role="radiogroup" aria-label="Metric" className="flex rounded-lg border border-line p-0.5">
              {(['revenue', 'orders'] as Metric[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={metric === m}
                  onClick={() => setMetric(m)}
                  className={`h-7 rounded-md px-2.5 text-[13px] ${metric === m ? 'bg-ink text-on-ink' : 'text-ink-2 hover:bg-hover'}`}
                >
                  {m === 'revenue' ? 'Sales' : 'Orders'}
                </button>
              ))}
            </div>
          }
        />
        <div className="px-4 pb-4 sm:px-6">
          <TrendChart
            data={trend}
            label={metric === 'revenue' ? 'Daily sales' : 'Daily orders'}
            formatAxis={(v) => (metric === 'revenue' ? formatINRCompact(v) : String(v))}
            formatValue={(v) => (metric === 'revenue' ? formatINR(v) : `${v} order${v === 1 ? '' : 's'}`)}
          />
          <button type="button" className="mt-1 text-[12.5px] text-ink-3 underline-offset-2 hover:text-ink hover:underline" onClick={() => setShowTable((t) => !t)}>
            {showTable ? 'Hide table' : 'Show as table'}
          </button>
          {showTable && (
            <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-line">
              <table className="w-full text-[13.5px]">
                <thead className="sticky top-0 bg-surface text-left text-[11px] uppercase tracking-[0.06em] text-ink-3">
                  <tr className="border-b border-line">
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 text-right font-medium">Orders</th>
                    <th className="px-3 py-2 text-right font-medium">Sales</th>
                    <th className="px-3 py-2 text-right font-medium">Received</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {[...d.daily].reverse().map((r) => (
                    <tr key={r.date}>
                      <td className="px-3 py-1.5">{r.date}</td>
                      <td className="px-3 py-1.5 text-right">{r.orders}</td>
                      <td className="px-3 py-1.5 text-right">{formatINR(r.revenuePaise)}</td>
                      <td className="px-3 py-1.5 text-right">{formatINR(r.receivedPaise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <div className={`grid transition-opacity lg:grid-cols-3 lg:divide-x lg:divide-line ${a.loading ? 'opacity-50' : ''}`}>
        <section className="border-b border-line lg:border-b-0">
          <SectionHeader title="Payment collection status" />
          <div className="px-4 py-5 sm:px-6">
            <PaymentBreakdown rows={d.payment} />
            <p className="mb-2 mt-6 text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3">Order status</p>
            <dl className="grid grid-cols-3 gap-2">
              {(['open', 'completed', 'cancelled'] as OrderStatus[]).map((st) => (
                <div key={st} className="rounded-lg border border-line px-3 py-2">
                  <dt className="text-[12px] text-ink-3">{ORDER_STATUS_LABEL[st]}</dt>
                  <dd className="text-[18px] tabular-nums text-ink">{statusCounts.get(st) ?? 0}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
        <section className="border-b border-line lg:border-b-0">
          <SectionHeader title="Highest-spending customers" />
          <div className="px-4 py-5 sm:px-6">
            {d.topCustomers.length ? (
              <BarList
                ariaLabel="Highest-spending customers by sales"
                rows={d.topCustomers.map((c) => ({
                  key: c.id,
                  label: (
                    <Link to={`/customers/${c.id}`} className="hover:underline">
                      {c.name}
                    </Link>
                  ),
                  value: c.revenuePaise,
                  valueLabel: formatINRCompact(c.revenuePaise),
                  detail: `${c.orders} order${c.orders === 1 ? '' : 's'}`,
                }))}
              />
            ) : (
              <p className="text-[13px] text-ink-3">No orders in this period.</p>
            )}
          </div>
        </section>
        <section>
          <SectionHeader title="Best-selling items" />
          <div className="px-4 py-5 sm:px-6">
            {d.topItems.length ? (
              <BarList
                ariaLabel="Best-selling items by sales"
                rows={d.topItems.map((it) => ({
                  key: it.name,
                  label: it.name,
                  value: it.revenuePaise,
                  valueLabel: formatINRCompact(it.revenuePaise),
                  detail: `${it.orders} order${it.orders === 1 ? '' : 's'}`,
                }))}
              />
            ) : (
              <p className="text-[13px] text-ink-3">No items sold in this period.</p>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
