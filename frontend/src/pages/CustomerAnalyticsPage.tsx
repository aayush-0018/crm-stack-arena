import { useState } from 'react';
import { Link } from 'react-router-dom';
import { dashboardApi } from '../api/endpoints';
import BarList from '../components/charts/BarList';
import { Sparkline, Stat, StatStrip, TickGauge } from '../components/charts/StatStrip';
import TrendChart from '../components/charts/TrendChart';
import { SectionHeader } from '../components/ui/Card';
import { ErrorState, LoadingState } from '../components/ui/States';
import { PageTop } from '../components/ui/Tabs';
import { useAsync } from '../lib/hooks';
import { formatINRCompact } from '../lib/money';
import type { AnalyticsDays } from '../types';

const PERIODS: AnalyticsDays[] = [1, 7, 30, 90, 180];
type Metric = 'buyers' | 'new';

const change = (cur: number, prev: number) => (prev ? `${cur >= prev ? '+' : '−'}${Math.abs(((cur - prev) / prev) * 100).toFixed(1)}%` : 'no prior data');
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

export default function CustomerAnalyticsPage() {
  const [days, setDays] = useState<AnalyticsDays>(30);
  const [metric, setMetric] = useState<Metric>('buyers');
  const a = useAsync(() => dashboardApi.customers(days), [days]);

  const top = (
    <PageTop
      tabs={PERIODS.map((d) => ({ key: String(d), label: d === 1 ? 'Today' : `Last ${d} days` }))}
      value={String(days)}
      onChange={(k) => setDays(Number(k) as AnalyticsDays)}
    />
  );

  if (!a.data) {
    return (
      <>
        {top}
        {a.error ? <ErrorState error={a.error} onRetry={a.reload} /> : <LoadingState label="Loading customer analytics…" />}
      </>
    );
  }

  const d = a.data;
  const s = d.summary;
  const prevLabel = days === 1 ? 'yesterday' : `the ${days} days before`;
  const trend = d.daily.map((p) => ({ date: p.date, value: metric === 'buyers' ? p.buyers : p.newCustomers }));
  const noun = (n: number) => `${n} customer${n === 1 ? '' : 's'}`;

  return (
    <>
      {top}
      <StatStrip page="customer-analytics" dim={a.loading}>
        <Stat label="Total customers" value={String(s.total)} suffix="all time" />
        <Stat
          label="New customers"
          value={String(s.newCustomers)}
          suffix={change(s.newCustomers, s.prevNewCustomers)}
          trend={s.newCustomers >= s.prevNewCustomers ? 'up' : 'down'}
          visual={<Sparkline values={d.daily.map((x) => x.newCustomers)} label="New customers per day" />}
        />
        <Stat
          label="Customers who ordered"
          value={String(s.buyers)}
          suffix={change(s.buyers, s.prevBuyers)}
          trend={s.buyers >= s.prevBuyers ? 'up' : 'down'}
          visual={<Sparkline values={d.daily.map((x) => x.buyers)} label="Customers who ordered per day" />}
        />
        <Stat
          label="Returning customers"
          value={String(s.returning)}
          suffix={`${pct(s.returning, s.buyers)}% of buyers`}
          visual={<TickGauge value={s.buyers ? s.returning / s.buyers : 0} label="Share of this period's buyers who had ordered before" />}
        />
        <Stat
          label="Retention"
          value={`${pct(s.retained, s.prevBuyers)}%`}
          suffix={`${s.retained} of ${s.prevBuyers}`}
          visual={<TickGauge value={s.prevBuyers ? s.retained / s.prevBuyers : 0} label={`Customers who ordered in ${prevLabel} and ordered again in this period`} />}
        />
      </StatStrip>

      {days > 1 && (
        <section className={`border-b border-line transition-opacity ${a.loading ? 'opacity-50' : ''}`}>
          <SectionHeader
            title={metric === 'buyers' ? 'Customers who ordered, per day' : 'New customers, per day'}
            className="border-b-0"
            actions={
              <div role="radiogroup" aria-label="Metric" className="flex rounded-lg border border-line p-0.5">
                {(['buyers', 'new'] as Metric[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={metric === m}
                    onClick={() => setMetric(m)}
                    className={`h-7 rounded-md px-2.5 text-[13px] ${metric === m ? 'bg-ink text-on-ink' : 'text-ink-2 hover:bg-hover'}`}
                  >
                    {m === 'buyers' ? 'Ordered' : 'New'}
                  </button>
                ))}
              </div>
            }
          />
          <div className="px-4 pb-4 sm:px-6">
            <TrendChart
              data={trend}
              label={metric === 'buyers' ? 'Customers who ordered per day' : 'New customers per day'}
              formatAxis={(v) => String(v)}
              formatValue={noun}
            />
          </div>
        </section>
      )}

      <div className={`grid transition-opacity lg:grid-cols-2 lg:divide-x lg:divide-line ${a.loading ? 'opacity-50' : ''}`}>
        <section className="border-b border-line lg:border-b-0">
          <SectionHeader title="Who ordered" />
          <div className="px-4 py-5 sm:px-6">
            <dl className="grid grid-cols-2 gap-2">
              {[
                ['First order', noun(s.firstTime)],
                ['Came back', noun(s.returning)],
                ['Came back from the period before', `${s.retained} of ${s.prevBuyers}`],
                ['Lost', noun(Math.max(0, s.prevBuyers - s.retained))],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg border border-line px-3 py-2">
                  <dt className="text-[12px] text-ink-3">{k}</dt>
                  <dd className="text-[15px] tabular-nums text-ink">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="mb-2 mt-6 text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3">All time</p>
            <dl className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-line px-3 py-2">
                <dt className="text-[12px] text-ink-3">Repeat rate</dt>
                <dd className="text-[18px] tabular-nums text-ink">
                  {pct(s.repeaters, s.everBought)}%
                  <span className="ml-1.5 text-[12px] text-ink-3">2+ orders</span>
                </dd>
              </div>
              <div className="rounded-lg border border-line px-3 py-2">
                <dt className="text-[12px] text-ink-3">Days between visits</dt>
                <dd className="text-[18px] tabular-nums text-ink">{Math.round(s.avgGapDays)}</dd>
              </div>
            </dl>
          </div>
        </section>
        <section>
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
              <p className="text-[13px] text-ink-3">No customer orders in this period.</p>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
