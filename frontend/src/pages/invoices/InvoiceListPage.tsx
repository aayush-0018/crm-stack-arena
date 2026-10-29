import { Download, X } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { invoicesApi } from '../../api/endpoints';
import { Sparkline, Stat, StatStrip, TickGauge } from '../../components/charts/StatStrip';
import CustomerHoverCard from '../../components/customers/CustomerHoverCard';
import DataTable, { Column } from '../../components/data/DataTable';
import BulkDelete from '../../components/data/BulkDelete';
import type { ColumnFilter } from '../../components/data/HeaderFilter';
import { ClearFilters, CustomizeButton, SearchBox, Toolbar, useHiddenColumns } from '../../components/data/Toolbar';
import Avatar from '../../components/ui/Avatar';
import { InvoiceBadge } from '../../components/ui/Badge';
import Button, { ButtonLink } from '../../components/ui/Button';
import Pagination from '../../components/ui/Pagination';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { PageTop } from '../../components/ui/Tabs';
import { downloadCsv, rupees } from '../../lib/csv';
import { formatDate } from '../../lib/date';
import { useAsync } from '../../lib/hooks';
import { formatINR, formatINRCompact } from '../../lib/money';
import type { InvoiceListItem, InvoiceStatus } from '../../types';

const PAGE_SIZE = 25;
type StatusFilter = InvoiceStatus | 'needs_reissue';
const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'issued', label: 'Issued' },
  { value: 'needs_reissue', label: 'Needs reissue' },
  { value: 'superseded', label: 'Superseded' },
  { value: 'void', label: 'Void' },
];

const COLUMNS: Column<InvoiceListItem>[] = [
  {
    key: 'number',
    header: 'Invoice',
    cell: (i) => (
      <span>
        <span className="font-medium text-ink">{i.invoiceNumber}</span>
        {i.revision > 1 && <span className="ml-2 text-[12.5px] text-ink-3">Rev {i.revision}</span>}
      </span>
    ),
  },
  { key: 'order', header: 'Order', optional: true, hideBelow: 'md', cell: (i) => <span className="text-ink-2">{i.orderNumber}</span> },
  {
    key: 'customer',
    header: 'Customer',
    cell: (i) => (
      <CustomerHoverCard customerId={i.customerId}>
        <span className="flex items-center gap-2.5">
          <Avatar name={i.customerName} />
          <span className="truncate hover:underline">{i.customerName}</span>
        </span>
      </CustomerHoverCard>
    ),
  },
  { key: 'date', header: 'Date', optional: true, hideBelow: 'sm', cell: (i) => <span className="text-ink-2">{formatDate(i.invoiceDate)}</span> },
  { key: 'amount', header: 'Amount', align: 'right', cell: (i) => formatINR(i.totalPaise) },
  {
    key: 'due',
    header: 'Due now',
    align: 'right',
    optional: true,
    hideBelow: 'lg',
    cell: (i) => <span className="text-ink-2">{i.status === 'issued' && i.orderDuePaise > 0 ? formatINR(i.orderDuePaise) : '—'}</span>,
  },
  { key: 'status', header: 'Status', cell: (i) => <InvoiceBadge status={i.status} outdated={i.outdated} /> },
];

export default function InvoiceListPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = (params.get('status') ?? '') as StatusFilter | '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const search = params.get('search') ?? '';
  const page = Number(params.get('page')) || 1;
  const [selected, setSelected] = useState<Set<number | string>>(new Set());
  const { hidden, toggle } = useHiddenColumns('crm.cols.invoices');

  const update = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };

  const summary = useAsync(() => invoicesApi.summary(), []);
  const list = useAsync(
    () => invoicesApi.list({ status, search: search || undefined, from: from || undefined, to: to || undefined, page, pageSize: PAGE_SIZE }),
    [status, search, from, to, page],
  );
  const filterCount = [status, from, to].filter(Boolean).length;
  const clearFilters = () => {
    setSelected(new Set());
    update({ status: undefined, from: undefined, to: undefined });
  };
  const filters: Record<string, ColumnFilter> = {
    status: {
      kind: 'options',
      value: status,
      options: STATUS_OPTIONS,
      onChange: (v) => {
        setSelected(new Set());
        update({ status: v || undefined });
      },
    },
    date: { kind: 'date', from, to, onChange: (f, t) => update({ from: f || undefined, to: t || undefined }) },
  };
  const columns = COLUMNS.map((c) => (filters[c.key] ? { ...c, filter: filters[c.key] } : c));
  const s = summary.data;
  const rows = list.data?.data ?? [];

  const exportCsv = (data: InvoiceListItem[]) =>
    downloadCsv(`invoices-${new Date().toISOString().slice(0, 10)}.csv`, data, [
      { header: 'Invoice', value: (i) => i.invoiceNumber },
      { header: 'Revision', value: (i) => i.revision },
      { header: 'Order', value: (i) => i.orderNumber },
      { header: 'Date', value: (i) => i.invoiceDate },
      { header: 'Customer', value: (i) => i.customerName },
      { header: 'Phone', value: (i) => i.customerPhone },
      { header: 'Amount (Rs)', value: (i) => rupees(i.totalPaise) },
      { header: 'Status', value: (i) => (i.outdated ? 'needs reissue' : i.status) },
    ]);

  return (
    <>
      <PageTop
        tabs={[
          { key: '', label: 'All invoices', count: s?.total },
          { key: 'issued', label: 'Issued' },
          { key: 'needs_reissue', label: 'Needs reissue', count: s?.outdated || undefined },
          { key: 'superseded', label: 'Superseded' },
          { key: 'void', label: 'Void' },
        ]}
        value={status}
        onChange={(k) => {
          setSelected(new Set());
          update({ status: k || undefined });
        }}
        actions={<ButtonLink to="/orders?status=open">Invoice an order</ButtonLink>}
      />

      {s && (
        <StatStrip page="invoices">
          <Stat
            label="Invoiced · 30d"
            value={formatINRCompact(s.invoiced30Paise)}
            visual={<Sparkline values={s.daily.map((d) => d.amountPaise)} label="Invoiced amount per day, last 30 days" />}
          />
          <Stat
            label="Invoices · 30d"
            value={String(s.issued30)}
            visual={<Sparkline values={s.daily.map((d) => d.count)} label="Invoices issued per day, last 30 days" />}
          />
          <Stat
            label="Due on invoices"
            value={formatINRCompact(s.duePaise)}
            suffix={s.issuedTotalPaise ? `${Math.round((s.duePaise / s.issuedTotalPaise) * 100)}%` : undefined}
            visual={<TickGauge value={s.issuedTotalPaise ? s.duePaise / s.issuedTotalPaise : 0} label="Share of invoiced amount still due" />}
          />
          <Stat
            label="Needs reissue"
            value={String(s.outdated)}
            suffix={s.outdated ? 'order changed' : 'all current'}
            visual={<TickGauge value={s.total ? s.outdated / s.total : 0} label="Issued invoices whose order changed afterwards" />}
          />
          <Stat
            label="Superseded / void"
            value={String(s.replaced)}
            visual={<TickGauge value={s.total ? s.replaced / s.total : 0} label="Share of invoices replaced or voided" />}
          />
        </StatStrip>
      )}

      <Toolbar
        right={
          selected.size > 0 ? (
            <>
              <span className="text-[13.5px] text-ink-2">{selected.size} selected</span>
              <Button size="sm" variant="secondary" onClick={() => exportCsv(rows.filter((r) => selected.has(r.id)))}>
                <Download size={14} /> Export
              </Button>
              <BulkDelete
                ids={[...selected]}
                noun={['invoice', 'invoices']}
                remove={(id) => invoicesApi.remove(id)}
                onDone={() => {
                  setSelected(new Set());
                  list.reload();
                  summary.reload();
                }}
                warning={<>The orders stay and can be invoiced again. Deleted invoice numbers aren't reused, and any links you sent customers stop working. <span className="text-ink">If you're GST-registered, an issued invoice is normally cancelled with a credit note — check with your accountant.</span></>}
              />
              <button type="button" aria-label="Clear selection" onClick={() => setSelected(new Set())} className="text-ink-3 hover:text-ink">
                <X size={16} />
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => exportCsv(rows)} disabled={!rows.length} className="hidden items-center gap-1.5 text-[14px] text-ink-2 hover:text-ink disabled:opacity-40 sm:inline-flex">
                <Download size={16} strokeWidth={1.75} /> Export
              </button>
              <CustomizeButton columns={COLUMNS.filter((c) => c.optional)} hidden={hidden} onToggle={toggle} />
            </>
          )
        }
      >
        <SearchBox value={search} onChange={(v) => update({ search: v || undefined })} placeholder="Search invoice, order, customer or phone" />
        {filterCount > 0 && <ClearFilters count={filterCount} onClear={clearFilters} />}
      </Toolbar>

      {list.loading && !list.data ? (
        <LoadingState />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={list.reload} />
      ) : !rows.length ? (
        <EmptyState
          title={search || filterCount ? 'No invoices match' : 'No invoices yet'}
          description={search || filterCount ? 'Try a different search or filter.' : 'Generate an invoice from any order.'}
          action={filterCount ? <Button variant="secondary" onClick={clearFilters}>Clear filters</Button> : undefined}
        />
      ) : (
        <>
          <DataTable
            label="Invoices"
            rows={rows}
            columns={columns}
            rowKey={(i) => i.id}
            hidden={hidden}
            selected={selected}
            onSelectedChange={setSelected}
            onRowClick={(i) => navigate(`/invoices/${i.id}`)}
            dim={list.loading}
          />
          <Pagination page={page} pageSize={PAGE_SIZE} total={list.data!.total} onChange={(p) => update({ page: String(p) })} />
        </>
      )}
    </>
  );
}
