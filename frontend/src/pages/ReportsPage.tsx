import { Download } from 'lucide-react';
import { ReactNode, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { reportsApi } from '../api/endpoints';
import { Stat, StatStrip } from '../components/charts/StatStrip';
import DataTable, { Column } from '../components/data/DataTable';
import { Toolbar } from '../components/data/Toolbar';
import { PAYMENT_METHOD_LABEL } from '../components/orders/Payments';
import Button from '../components/ui/Button';
import { SectionHeader } from '../components/ui/Card';
import { TextField } from '../components/ui/Field';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/States';
import { PageTop } from '../components/ui/Tabs';
import { downloadCsv, rupees } from '../lib/csv';
import { formatDate, todayIST } from '../lib/date';
import { useAsync } from '../lib/hooks';
import { formatINR } from '../lib/money';
import type { AgeingBucket, AgeingReport, CollectionsReport } from '../types';

type Tab = 'ageing' | 'collections';
const BUCKET_LABEL: Record<AgeingBucket, string> = { '0-30': '0–30 days', '31-60': '31–60 days', '61-90': '61–90 days', '90+': '90+ days' };
const methodLabel = (m: string) => PAYMENT_METHOD_LABEL[m as keyof typeof PAYMENT_METHOD_LABEL] ?? m;

/** Two-way toggle in the style used on the Analytics page. */
function Toggle<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-lg border border-line p-0.5">
      {options.map(([v, l]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={`h-7 rounded-md px-2.5 text-[13px] ${value === v ? 'bg-ink text-on-ink' : 'text-ink-2 hover:bg-hover'}`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

const exportBtn = 'inline-flex items-center gap-1.5 text-[14px] text-ink-2 hover:text-ink disabled:opacity-40';

export default function ReportsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'ageing';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const [draft, setDraft] = useState({ from, to });
  const [lastKey, setLastKey] = useState(`${from}|${to}`);
  if (`${from}|${to}` !== lastKey) {
    setLastKey(`${from}|${to}`);
    setDraft({ from, to });
  }

  const update = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };
  const rangeError = draft.from && draft.to && draft.from > draft.to ? 'The start date is after the end date' : undefined;

  return (
    <>
      <PageTop
        tabs={[
          { key: 'ageing', label: 'Outstanding & ageing' },
          { key: 'collections', label: 'Collections' },
        ]}
        value={tab}
        onChange={(k) => update({ tab: k === 'ageing' ? undefined : k })}
      />
      <Toolbar>
        <form
          className="flex flex-wrap items-end gap-3 py-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (!rangeError) update({ from: draft.from || undefined, to: draft.to || undefined });
          }}
        >
          <TextField
            label={tab === 'ageing' ? 'Orders from' : 'Paid from'}
            type="date"
            value={draft.from}
            max={todayIST()}
            onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
            className="w-40"
          />
          <TextField label="to" type="date" value={draft.to} onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} className="w-40" error={rangeError} />
          <Button type="submit" size="sm" variant="secondary" disabled={!!rangeError}>
            Apply
          </Button>
          {(from || to) && (
            <button type="button" className="h-8 text-[13px] text-ink-3 underline-offset-2 hover:text-ink hover:underline" onClick={() => update({ from: undefined, to: undefined })}>
              Clear dates
            </button>
          )}
        </form>
      </Toolbar>
      {tab === 'ageing' ? <AgeingView from={from} to={to} /> : <CollectionsView from={from} to={to} />}
    </>
  );
}

function AgeingView({ from, to }: { from: string; to: string }) {
  const navigate = useNavigate();
  const [view, setView] = useState<'customers' | 'orders'>('customers');
  const report = useAsync(() => reportsApi.ageing({ from: from || undefined, to: to || undefined }), [from, to]);
  if (report.loading && !report.data) return <LoadingState />;
  if (report.error || !report.data) return <ErrorState error={report.error ?? 'Could not load the report'} onRetry={report.reload} />;
  const r = report.data;
  const t = r.totals;

  const bucketCols = <T extends Record<AgeingBucket, number>>(): Column<T>[] =>
    r.buckets.map((b) => ({ key: b, header: BUCKET_LABEL[b], align: 'right' as const, hideBelow: 'md' as const, cell: (row: T) => (row[b] ? formatINR(row[b]) : '—') }));
  const customerCols: Column<AgeingReport['customers'][number]>[] = [
    {
      key: 'name',
      header: 'Customer',
      cell: (c) =>
        c.customerId ? (
          <Link to={`/customers/${c.customerId}`} onClick={(e) => e.stopPropagation()} className="text-ink hover:underline">
            {c.customerName}
          </Link>
        ) : (
          <span className="text-ink-2">{c.customerName}</span>
        ),
    },
    { key: 'orders', header: 'Orders', align: 'right', cell: (c) => c.orders },
    ...bucketCols<AgeingReport['customers'][number]>(),
    { key: 'total', header: 'Total due', align: 'right', cell: (c) => <span className="font-medium text-ink">{formatINR(c.totalPaise)}</span> },
  ];
  const orderCols: Column<AgeingReport['orders'][number]>[] = [
    { key: 'order', header: 'Order', cell: (o) => <span className="text-ink">{o.orderNumber}</span> },
    { key: 'customer', header: 'Customer', hideBelow: 'sm', cell: (o) => o.customerName ?? <span className="text-ink-2">Walk-in</span> },
    { key: 'date', header: 'Order date', hideBelow: 'md', cell: (o) => formatDate(o.orderDate) },
    { key: 'age', header: 'Age', align: 'right', cell: (o) => `${o.ageDays} d` },
    { key: 'total', header: 'Total', align: 'right', hideBelow: 'lg', cell: (o) => formatINR(o.totalPaise) },
    { key: 'paid', header: 'Paid', align: 'right', hideBelow: 'lg', cell: (o) => formatINR(o.paidPaise) },
    { key: 'due', header: 'Due', align: 'right', cell: (o) => <span className="font-medium text-ink">{formatINR(o.duePaise)}</span> },
    {
      key: 'invoice',
      header: 'Invoice',
      hideBelow: 'md',
      cell: (o) =>
        o.invoiceId ? (
          <Link to={`/invoices/${o.invoiceId}`} onClick={(e) => e.stopPropagation()} className="hover:underline">
            {o.invoiceNumber}
          </Link>
        ) : (
          <span className="text-ink-3">—</span>
        ),
    },
  ];

  const exportCsv = () =>
    view === 'customers'
      ? downloadCsv(`ageing-by-customer-${r.asOf}.csv`, r.customers, [
          { header: 'Customer', value: (c) => c.customerName },
          { header: 'Phone', value: (c) => c.customerPhone },
          { header: 'Orders', value: (c) => c.orders },
          ...r.buckets.map((b) => ({ header: `${BUCKET_LABEL[b]} (Rs)`, value: (c: AgeingReport['customers'][number]) => rupees(c[b]) })),
          { header: 'Total due (Rs)', value: (c) => rupees(c.totalPaise) },
          { header: 'Oldest order', value: (c) => c.oldestOrderDate },
        ])
      : downloadCsv(`ageing-by-order-${r.asOf}.csv`, r.orders, [
          { header: 'Order', value: (o) => o.orderNumber },
          { header: 'Order date', value: (o) => o.orderDate },
          { header: 'Customer', value: (o) => o.customerName ?? 'Walk-in' },
          { header: 'Phone', value: (o) => o.customerPhone },
          { header: 'Age (days)', value: (o) => o.ageDays },
          { header: 'Bucket', value: (o) => BUCKET_LABEL[o.bucket] },
          { header: 'Total (Rs)', value: (o) => rupees(o.totalPaise) },
          { header: 'Paid (Rs)', value: (o) => rupees(o.paidPaise) },
          { header: 'Due (Rs)', value: (o) => rupees(o.duePaise) },
          { header: 'Invoice', value: (o) => o.invoiceNumber },
        ]);

  return (
    <>
      <StatStrip page="report-ageing" dim={report.loading}>
        <Stat label="Total outstanding" value={formatINR(t.totalPaise)} />
        {r.buckets.map((b) => (
          <Stat key={b} label={BUCKET_LABEL[b]} value={formatINR(t[b])} />
        ))}
      </StatStrip>
      <SectionHeader
        title={
          <span className="text-[14px] font-normal text-ink-2">
            {t.orders} order{t.orders === 1 ? '' : 's'} due · as of {formatDate(r.asOf)} · age counted from the order date
          </span>
        }
        actions={
          <>
            <Toggle
              label="Group by"
              value={view}
              onChange={setView}
              options={[
                ['customers', 'By customer'],
                ['orders', 'By order'],
              ]}
            />
            <button type="button" onClick={exportCsv} disabled={!t.orders} className={exportBtn}>
              <Download size={16} strokeWidth={1.75} /> Export
            </button>
          </>
        }
      />
      {!t.orders ? (
        <EmptyState title="Nothing outstanding" description={from || to ? 'No order in these dates has money due.' : 'Every order is paid up.'} />
      ) : view === 'customers' ? (
        <DataTable
          label="Outstanding by customer"
          rows={r.customers}
          columns={customerCols}
          rowKey={(c) => c.customerId ?? 'walk-in'}
          onRowClick={(c) => c.customerId && navigate(`/customers/${c.customerId}`)}
          dim={report.loading}
        />
      ) : (
        <DataTable label="Outstanding orders" rows={r.orders} columns={orderCols} rowKey={(o) => o.id} onRowClick={(o) => navigate(`/orders/${o.id}`)} dim={report.loading} />
      )}
    </>
  );
}

function CollectionsView({ from, to }: { from: string; to: string }) {
  const [view, setView] = useState<'methods' | 'days'>('methods');
  const report = useAsync(() => reportsApi.collections({ from: from || undefined, to: to || undefined }), [from, to]);
  if (report.loading && !report.data) return <LoadingState />;
  if (report.error || !report.data) return <ErrorState error={report.error ?? 'Could not load the report'} onRetry={report.reload} />;
  const r = report.data;
  const t = r.totals;
  const money = (v: number): ReactNode => (v ? formatINR(v) : '—');

  type MethodRow = CollectionsReport['byMethod'][number];
  type DayRow = CollectionsReport['rows'][number];
  const methodCols: Column<MethodRow>[] = [
    { key: 'method', header: 'Method', cell: (m) => <span className="text-ink">{methodLabel(m.method)}</span> },
    { key: 'count', header: 'Entries', align: 'right', hideBelow: 'sm', cell: (m) => m.payments + m.refunds },
    { key: 'in', header: 'Received', align: 'right', cell: (m) => money(m.receivedPaise) },
    { key: 'out', header: 'Refunded', align: 'right', cell: (m) => money(m.refundedPaise) },
    { key: 'net', header: 'Net', align: 'right', cell: (m) => <span className="font-medium text-ink">{formatINR(m.netPaise)}</span> },
  ];
  const dayCols: Column<DayRow>[] = [
    { key: 'date', header: 'Date', cell: (d) => formatDate(d.date) },
    { key: 'method', header: 'Method', cell: (d) => methodLabel(d.method) },
    { key: 'in', header: 'Received', align: 'right', cell: (d) => money(d.receivedPaise) },
    { key: 'out', header: 'Refunded', align: 'right', cell: (d) => money(d.refundedPaise) },
    { key: 'net', header: 'Net', align: 'right', cell: (d) => <span className="font-medium text-ink">{formatINR(d.netPaise)}</span> },
  ];

  const exportCsv = () =>
    downloadCsv(`collections-${r.from}-to-${r.to}.csv`, r.rows, [
      { header: 'Date', value: (d) => d.date },
      { header: 'Method', value: (d) => methodLabel(d.method) },
      { header: 'Payments', value: (d) => d.payments },
      { header: 'Received (Rs)', value: (d) => rupees(d.receivedPaise) },
      { header: 'Refunds', value: (d) => d.refunds },
      { header: 'Refunded (Rs)', value: (d) => rupees(d.refundedPaise) },
      { header: 'Net (Rs)', value: (d) => rupees(d.netPaise) },
    ]);

  return (
    <>
      <StatStrip page="report-collections" dim={report.loading}>
        <Stat label="Received" value={formatINR(t.receivedPaise)} />
        <Stat label="Refunded" value={formatINR(t.refundedPaise)} />
        <Stat label="Net collected" value={formatINR(t.netPaise)} />
      </StatStrip>
      <SectionHeader
        title={
          <span className="text-[14px] font-normal text-ink-2">
            {formatDate(r.from)} – {formatDate(r.to)} · by payment date · {t.payments + t.refunds} ledger entr{t.payments + t.refunds === 1 ? 'y' : 'ies'}
          </span>
        }
        actions={
          <>
            <Toggle
              label="Group by"
              value={view}
              onChange={setView}
              options={[
                ['methods', 'By method'],
                ['days', 'By date'],
              ]}
            />
            <button type="button" onClick={exportCsv} disabled={!r.rows.length} className={exportBtn}>
              <Download size={16} strokeWidth={1.75} /> Export
            </button>
          </>
        }
      />
      {!r.rows.length ? (
        <EmptyState title="No money in or out" description="No payments or refunds were recorded in these dates." />
      ) : view === 'methods' ? (
        <DataTable label="Collections by method" rows={r.byMethod} columns={methodCols} rowKey={(m) => m.method} dim={report.loading} />
      ) : (
        <DataTable label="Collections by date and method" rows={r.rows} columns={dayCols} rowKey={(d) => `${d.date}-${d.method}`} dim={report.loading} />
      )}
    </>
  );
}
