import { useState } from 'react';
import { reportsApi } from '../api/endpoints';
import PeriodBars from '../components/charts/PeriodBars';
import { Stat, StatStrip } from '../components/charts/StatStrip';
import { PAYMENT_METHOD_LABEL } from '../components/orders/Payments';
import { SectionHeader } from '../components/ui/Card';
import { ErrorState, LoadingState } from '../components/ui/States';
import { PageTop } from '../components/ui/Tabs';
import { useAuth } from '../context/AuthContext';
import { MONTH_NAMES } from '../lib/fy';
import { useAsync } from '../lib/hooks';
import { formatINR, formatINRCompact } from '../lib/money';
import type { GrowthBasis, GrowthDimension, GrowthGrain, GrowthMetrics } from '../types';

type MetricKey = keyof GrowthMetrics;

const METRICS: { key: MetricKey; label: string; money: boolean; hint: string }[] = [
  { key: 'revenuePaise', label: 'Sales', money: true, hint: 'Order totals after discounts and returns, by order date. Cancelled orders left out.' },
  { key: 'orders', label: 'Orders', money: false, hint: 'Orders placed, not counting cancelled ones.' },
  { key: 'aovPaise', label: 'Average order', money: true, hint: 'Sales ÷ orders.' },
  { key: 'customers', label: 'Customers who ordered', money: false, hint: 'Different customers with an order (walk-in sales not counted).' },
  { key: 'newCustomers', label: 'New customers', money: false, hint: 'Customers whose first ever order fell in the period.' },
  { key: 'receivedPaise', label: 'Money received', money: true, hint: 'Payments minus refunds, by payment date.' },
];

const GRAIN_TEXT: Record<GrowthGrain, { tab: string; prev: string; short: string; noun: string }> = {
  month: { tab: 'Monthly', prev: 'MoM', short: 'month', noun: 'Month' },
  quarter: { tab: 'Quarterly', prev: 'QoQ', short: 'quarter', noun: 'Quarter' },
  year: { tab: 'Yearly', prev: 'YoY', short: 'year', noun: 'Year' },
};

const DIMENSIONS: { key: GrowthDimension; label: string; title: string }[] = [
  { key: 'category', label: 'Category', title: 'Sales by product category' },
  { key: 'product', label: 'Product', title: 'Sales by product (top 15)' },
  { key: 'channel', label: 'Channel', title: 'Sales by channel' },
  { key: 'payment', label: 'Payment method', title: 'Money received by payment method' },
];

/** % change, or null when there's nothing to compare against. */
const growth = (cur: number, prev: number) => (prev ? ((cur - prev) / Math.abs(prev)) * 100 : null);
const pctText = (g: number | null) => (g === null ? '—' : `${g >= 0 ? '+' : '−'}${Math.abs(g) >= 100 ? Math.round(Math.abs(g)) : Math.abs(g).toFixed(1)}%`);

function Change({ cur, prev, className = '' }: { cur: number; prev: number; className?: string }) {
  const g = growth(cur, prev);
  const tone = g === null || Math.abs(g) < 0.05 ? 'text-ink-3' : g > 0 ? 'text-success-text' : 'text-danger-text';
  return <span className={`tabular-nums ${tone} ${className}`}>{g === null ? (cur ? 'new' : '—') : pctText(g)}</span>;
}

function Radio<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { key: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap rounded-lg border border-line p-0.5">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={value === o.key}
          onClick={() => onChange(o.key)}
          className={`h-7 rounded-md px-2.5 text-[13px] ${value === o.key ? 'bg-ink text-on-ink' : 'text-ink-2 hover:bg-hover'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Growth: MoM / QoQ / YoY on sales and other measures, with a breakdown by one dimension. */
export default function GrowthPage() {
  const [grain, setGrain] = useState<GrowthGrain>('month');
  const [basis, setBasis] = useState<GrowthBasis>('to_date');
  const [by, setBy] = useState<GrowthDimension>('category');
  const [metric, setMetric] = useState<MetricKey>('revenuePaise');
  const r = useAsync(() => reportsApi.growth({ grain, basis, by }), [grain, basis, by]);
  const g = GRAIN_TEXT[grain];
  const fy = useAuth().shop?.fyStartMonth ?? 1;
  const tabLabel = (k: GrowthGrain) => (k === 'year' && fy !== 1 ? 'Financial year' : GRAIN_TEXT[k].tab);

  const top = (
    <PageTop
      tabs={(Object.keys(GRAIN_TEXT) as GrowthGrain[]).map((k) => ({ key: k, label: tabLabel(k) }))}
      value={grain}
      onChange={(k) => setGrain(k as GrowthGrain)}
      actions={
        <Radio
          label="Compare"
          value={basis}
          onChange={setBasis}
          options={[
            { key: 'to_date', label: `This ${g.short} so far` },
            { key: 'last_full', label: `Last full ${g.short}` },
          ]}
        />
      }
    />
  );

  if (!r.data) {
    return (
      <>
        {top}
        {r.error ? <ErrorState error={r.error} onRetry={r.reload} /> : <LoadingState label="Loading growth…" />}
      </>
    );
  }

  const d = r.data;
  const { current, previous, lastYear } = d.summary;
  const yearOnly = d.grain === 'year'; // the period before *is* last year
  const m = METRICS.find((x) => x.key === metric)!;
  const fmt = (v: number, money = m.money) => (money ? formatINR(v) : v.toLocaleString('en-IN'));
  const dim = DIMENSIONS.find((x) => x.key === d.breakdown.by)!;
  const rowLabel = (label: string) => (d.breakdown.by === 'payment' ? PAYMENT_METHOD_LABEL[label as keyof typeof PAYMENT_METHOD_LABEL] ?? label : label);
  const dimRows = d.breakdown.rows;
  const dimTotals = dimRows.reduce((t, x) => ({ current: t.current + x.current, previous: t.previous + x.previous, lastYear: t.lastYear + x.lastYear }), { current: 0, previous: 0, lastYear: 0 });

  return (
    <>
      {top}
      <p className="border-b border-line px-4 py-3 text-[13px] text-ink-2 sm:px-6">
        <span className="text-ink">{d.ranges.current.label}</span> compared with <span className="text-ink">{d.ranges.previous.label}</span>
        {!yearOnly && (
          <>
            {' '}
            ({g.prev}) and <span className="text-ink">{d.ranges.lastYear.label}</span> (YoY)
          </>
        )}
        {yearOnly && ' (YoY)'}.{d.basis === 'to_date' && ' Same number of days in each, so the comparison is fair mid-period.'}
        {d.grain !== 'month' &&
          (d.fyStartMonth === 1
            ? ' Calendar quarters and years.'
            : ` Financial year from ${MONTH_NAMES[d.fyStartMonth - 1]} (change it in Settings).`)}
      </p>

      <StatStrip page="growth" dim={r.loading} even={3}>
        {METRICS.map((x) => {
          const cur = current[x.key];
          const prev = previous[x.key];
          const ly = lastYear[x.key];
          return (
            <Stat
              key={x.key}
              label={x.label}
              value={x.money ? formatINRCompact(cur) : cur.toLocaleString('en-IN')}
              suffix={`was ${x.money ? formatINRCompact(prev) : prev.toLocaleString('en-IN')}`}
              trend={cur === prev ? undefined : cur > prev ? 'up' : 'down'}
              visual={
                <p className="flex flex-wrap gap-x-4 gap-y-0.5 text-[12.5px] text-ink-3">
                  <span>
                    {g.prev} <Change cur={cur} prev={prev} />
                  </span>
                  {!yearOnly && (
                    <span>
                      YoY <Change cur={cur} prev={ly} />
                    </span>
                  )}
                </p>
              }
            />
          );
        })}
      </StatStrip>

      <section className={`border-b border-line transition-opacity ${r.loading ? 'opacity-50' : ''}`}>
        <SectionHeader
          title={`${m.label} by ${g.short}`}
          className="border-b-0"
          actions={<Radio label="Measure" value={metric} onChange={setMetric} options={METRICS.map((x) => ({ key: x.key, label: x.label }))} />}
        />
        <div className="px-4 pb-2 sm:px-6">
          <p className="mb-3 text-[12px] text-ink-3">{m.hint}</p>
          <PeriodBars
            data={d.series.map((p) => ({ key: p.start, label: p.label.replace(/ (\d{2})(\d{2})$/, " '$2").replace('FY 20', 'FY'), value: p[metric], compare: p.lastYear[metric], partial: p.partial }))}
            label={`${m.label} by ${g.short}, against a year earlier`}
            formatAxis={(v) => (m.money ? formatINRCompact(v) : String(v))}
            formatValue={(v) => fmt(v)}
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13.5px]">
            <thead>
              <tr className="border-y border-line text-[12px] text-ink-3">
                <th className="py-2 pl-4 text-left font-medium sm:pl-6">{g.noun}</th>
                <th className="px-3 py-2 text-right font-medium">{m.label}</th>
                {!yearOnly && <th className="px-3 py-2 text-right font-medium">{g.prev}</th>}
                <th className="px-3 py-2 text-right font-medium">A year earlier</th>
                <th className="py-2 pl-3 pr-4 text-right font-medium sm:pr-6">YoY</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {[...d.series].reverse().map((p) => (
                <tr key={p.start}>
                  <td className="py-2 pl-4 text-ink sm:pl-6">
                    {p.label}
                    {p.partial && <span className="ml-1.5 text-[12px] text-ink-3">so far</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink">{fmt(p[metric])}</td>
                  {!yearOnly && (
                    <td className="px-3 py-2 text-right">
                      {p.previous ? <Change cur={p[metric]} prev={p.previous[metric]} /> : <span className="text-ink-3">—</span>}
                    </td>
                  )}
                  <td className="px-3 py-2 text-right tabular-nums text-ink-2">{fmt(p.lastYear[metric])}</td>
                  <td className="py-2 pl-3 pr-4 text-right sm:pr-6">
                    <Change cur={p[metric]} prev={p.lastYear[metric]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {d.basis === 'to_date' && (
          <p className="px-4 py-3 text-[12px] text-ink-3 sm:px-6">
            The current {g.short} is still running, so its change in this table is against whole periods. The figures at the top compare like for like.
          </p>
        )}
      </section>

      <section className={`transition-opacity ${r.loading ? 'opacity-50' : ''}`}>
        <SectionHeader
          title={dim.title}
          className="border-b-0"
          actions={<Radio label="Break down by" value={by} onChange={setBy} options={DIMENSIONS.map((x) => ({ key: x.key, label: x.label }))} />}
        />
        {dimRows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[13.5px]">
              <thead>
                <tr className="border-y border-line text-[12px] text-ink-3">
                  <th className="py-2 pl-4 text-left font-medium sm:pl-6">{dim.label}</th>
                  <th className="px-3 py-2 text-right font-medium">{d.ranges.current.label}</th>
                  <th className="px-3 py-2 text-right font-medium">{d.ranges.previous.label}</th>
                  <th className="px-3 py-2 text-right font-medium">{g.prev}</th>
                  {!yearOnly && (
                    <>
                      <th className="px-3 py-2 text-right font-medium">{d.ranges.lastYear.label}</th>
                      <th className="px-3 py-2 text-right font-medium">YoY</th>
                    </>
                  )}
                  <th className="py-2 pl-3 pr-4 text-right font-medium sm:pr-6">Share</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {dimRows.map((x) => (
                  <tr key={x.label}>
                    <td className="max-w-[240px] truncate py-2 pl-4 text-ink sm:pl-6">{rowLabel(x.label)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink">{formatINR(x.current)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-2">{formatINR(x.previous)}</td>
                    <td className="px-3 py-2 text-right">
                      <Change cur={x.current} prev={x.previous} />
                    </td>
                    {!yearOnly && (
                      <>
                        <td className="px-3 py-2 text-right tabular-nums text-ink-2">{formatINR(x.lastYear)}</td>
                        <td className="px-3 py-2 text-right">
                          <Change cur={x.current} prev={x.lastYear} />
                        </td>
                      </>
                    )}
                    <td className="py-2 pl-3 pr-4 text-right tabular-nums text-ink-3 sm:pr-6">
                      {dimTotals.current ? `${Math.round((x.current / dimTotals.current) * 100)}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
              {d.breakdown.by !== 'product' && (
                <tfoot>
                  <tr className="border-t border-line font-medium">
                    <td className="py-2 pl-4 text-ink sm:pl-6">Total</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink">{formatINR(dimTotals.current)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-2">{formatINR(dimTotals.previous)}</td>
                    <td className="px-3 py-2 text-right">
                      <Change cur={dimTotals.current} prev={dimTotals.previous} />
                    </td>
                    {!yearOnly && (
                      <>
                        <td className="px-3 py-2 text-right tabular-nums text-ink-2">{formatINR(dimTotals.lastYear)}</td>
                        <td className="px-3 py-2 text-right">
                          <Change cur={dimTotals.current} prev={dimTotals.lastYear} />
                        </td>
                      </>
                    )}
                    <td className="pr-4 sm:pr-6" />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        ) : (
          <p className="border-t border-line px-4 py-6 text-[13px] text-ink-3 sm:px-6">Nothing to compare in these periods yet.</p>
        )}
        {(d.breakdown.by === 'category' || d.breakdown.by === 'product') && (
          <p className="px-4 py-3 text-[12px] text-ink-3 sm:px-6">Line amounts before order-level discounts, less returns. Typed-in items with no product show under “No category”.</p>
        )}
      </section>
    </>
  );
}
