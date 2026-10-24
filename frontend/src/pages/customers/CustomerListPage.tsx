import { Download, X } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { customersApi } from '../../api/endpoints';
import { Sparkline, Stat, StatStrip, TickGauge } from '../../components/charts/StatStrip';
import CustomerHoverCard from '../../components/customers/CustomerHoverCard';
import DataTable, { Column } from '../../components/data/DataTable';
import { CustomizeButton, FilterButton, FilterOptions, SearchBox, Toolbar, useHiddenColumns } from '../../components/data/Toolbar';
import Avatar from '../../components/ui/Avatar';
import { SEGMENT_LABEL, SegmentBadge } from '../../components/ui/Badge';
import Button, { ButtonLink } from '../../components/ui/Button';
import Pagination from '../../components/ui/Pagination';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { PageTop } from '../../components/ui/Tabs';
import { downloadCsv, rupees } from '../../lib/csv';
import { relativeDays } from '../../lib/date';
import { useAsync } from '../../lib/hooks';
import { formatINR } from '../../lib/money';
import type { Customer, CustomerSegment } from '../../types';

const PAGE_SIZE = 25;
type SortKey = 'name' | 'created' | 'lastOrder' | 'spent' | 'orders';
const SORT_LABEL: Record<SortKey, string> = { name: 'Name', created: 'Recently added', lastOrder: 'Last order', spent: 'Total spent', orders: 'Orders' };
const DEFAULT_DIR: Record<SortKey, 'asc' | 'desc'> = { name: 'asc', created: 'desc', lastOrder: 'desc', spent: 'desc', orders: 'desc' };

const COLUMNS: Column<Customer>[] = [
  {
    key: 'name',
    header: 'Name',
    sortKey: 'name',
    cell: (c) => (
      <CustomerHoverCard customerId={c.id} customer={c}>
        <span className="flex items-center gap-2.5">
          <Avatar name={c.name} />
          <span className="truncate text-ink hover:underline">{c.name}</span>
        </span>
      </CustomerHoverCard>
    ),
  },
  { key: 'phone', header: 'Phone', optional: true, hideBelow: 'sm', cell: (c) => <span className="tabular-nums text-ink">{c.phone}</span> },
  { key: 'address', header: 'Address', optional: true, hideBelow: 'lg', cell: (c) => <span className="block max-w-[220px] truncate text-ink">{c.address || '—'}</span> },
  { key: 'orders', header: 'Orders', sortKey: 'orders', align: 'right', optional: true, hideBelow: 'md', cell: (c) => c.orderCount ?? 0 },
  { key: 'lastOrder', header: 'Last order', sortKey: 'lastOrder', optional: true, hideBelow: 'md', cell: (c) => <span className="text-ink">{relativeDays(c.lastOrderDate)}</span> },
  { key: 'spent', header: 'Total spent', sortKey: 'spent', align: 'right', optional: true, hideBelow: 'lg', cell: (c) => formatINR(c.totalSpentPaise ?? 0) },
  { key: 'due', header: 'Due', align: 'right', optional: true, hideBelow: 'lg', cell: (c) => <span className="text-ink-2">{c.duePaise ? formatINR(c.duePaise) : '—'}</span> },
  { key: 'status', header: 'Status', cell: (c) => (c.segment ? <SegmentBadge segment={c.segment} /> : null) },
];

export default function CustomerListPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const segment = (params.get('segment') ?? '') as CustomerSegment | '';
  const search = params.get('search') ?? '';
  const sort = (params.get('sort') as SortKey) || 'name';
  const dir = (params.get('dir') as 'asc' | 'desc') || DEFAULT_DIR[sort];
  const page = Number(params.get('page')) || 1;
  const [selected, setSelected] = useState<Set<number | string>>(new Set());
  const { hidden, toggle } = useHiddenColumns('crm.cols.customers', ['due']);

  const update = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };

  const summary = useAsync(() => customersApi.summary(), []);
  const list = useAsync(
    () => customersApi.list({ segment, search: search || undefined, sort, dir, page, pageSize: PAGE_SIZE }),
    [segment, search, sort, dir, page],
  );

  const s = summary.data;
  const rows = list.data?.data ?? [];
  const selectedRows = rows.filter((r) => selected.has(r.id));

  const onSort = (key: string) => {
    const k = key as SortKey;
    update({ sort: k, dir: sort === k ? (dir === 'asc' ? 'desc' : 'asc') : DEFAULT_DIR[k] });
  };

  const exportCsv = (data: Customer[]) =>
    downloadCsv(`customers-${new Date().toISOString().slice(0, 10)}.csv`, data, [
      { header: 'Name', value: (c) => c.name },
      { header: 'Phone', value: (c) => c.phone },
      { header: 'Email', value: (c) => c.email },
      { header: 'Address', value: (c) => c.address },
      { header: 'Orders', value: (c) => c.orderCount },
      { header: 'Last order', value: (c) => c.lastOrderDate },
      { header: 'Total spent (Rs)', value: (c) => rupees(c.totalSpentPaise) },
      { header: 'Due (Rs)', value: (c) => rupees(c.duePaise) },
      { header: 'Status', value: (c) => (c.segment ? SEGMENT_LABEL[c.segment] : '') },
    ]);

  return (
    <>
      <PageTop
        tabs={[
          { key: '', label: 'All customers', count: s?.total },
          { key: 'active', label: 'Active', count: s ? s.total - s.new - s.vip - s.forgotten : undefined },
          { key: 'new', label: 'New', count: s?.new },
          { key: 'vip', label: 'VIP', count: s?.vip },
          { key: 'forgotten', label: 'Forgotten', count: s?.forgotten },
        ]}
        value={segment}
        onChange={(k) => {
          setSelected(new Set());
          update({ segment: k || undefined });
        }}
        actions={<ButtonLink to="/customers/new">Add customer</ButtonLink>}
      />

      {s && (
        <StatStrip>
          <Stat
            label="Total customers"
            value={String(s.total)}
            trend={s.trend.length > 1 && s.trend[s.trend.length - 1].total > s.trend[0].total ? 'up' : undefined}
            visual={<Sparkline values={s.trend.map((t) => t.total)} label="Total customers, last 12 weeks" />}
          />
          <Stat
            label="Active customers"
            value={String(s.active)}
            suffix={`${s.total ? Math.round((s.active / s.total) * 100) : 0}%`}
            trend={s.trend.length > 1 && s.trend[s.trend.length - 1].active >= s.trend[s.trend.length - 2].active ? 'up' : 'down'}
            visual={<Sparkline values={s.trend.map((t) => t.active)} label="Customers who ordered in the trailing 60 days, weekly" />}
          />
          <Stat
            label="Forgotten"
            value={String(s.forgotten)}
            suffix={`${s.total ? Math.round((s.forgotten / s.total) * 100) : 0}%`}
            visual={<TickGauge value={s.total ? s.forgotten / s.total : 0} label="Share of customers with no order in 60+ days" />}
          />
          <Stat
            label="Visit gap"
            value={`${Math.round(s.avgGapDays)}d`}
            suffix={s.avgGapDays <= 30 ? 'Normal' : 'Slow'}
            visual={<TickGauge value={Math.min(1, s.avgGapDays / 60)} reference={0.5} label="Average days between a customer's orders, out of 60" />}
          />
          <Stat
            label="Repeat rate"
            value={`${s.buyers ? Math.round((s.repeaters / s.buyers) * 100) : 0}%`}
            visual={<TickGauge value={s.buyers ? s.repeaters / s.buyers : 0} label="Share of buyers with 2+ orders" />}
          />
        </StatStrip>
      )}

      <Toolbar
        right={
          selected.size > 0 ? (
            <>
              <span className="text-[13.5px] text-ink-2">{selected.size} selected</span>
              <Button size="sm" variant="secondary" onClick={() => exportCsv(selectedRows)}>
                <Download size={14} /> Export
              </Button>
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
        <FilterButton count={(segment ? 1 : 0) + (sort !== 'name' ? 1 : 0)}>
          {(close) => (
            <>
              <FilterOptions
                label="Status"
                value={segment}
                options={(Object.keys(SEGMENT_LABEL) as CustomerSegment[]).map((k) => ({ value: k, label: SEGMENT_LABEL[k] }))}
                onChange={(v) => update({ segment: v || undefined })}
              />
              <FilterOptions
                label="Sort by"
                value={sort}
                options={(Object.keys(SORT_LABEL) as SortKey[]).map((k) => ({ value: k, label: SORT_LABEL[k] }))}
                onChange={(v) => {
                  const k = (v || 'name') as SortKey;
                  update({ sort: k === 'name' ? undefined : k, dir: undefined });
                }}
              />
              <div className="border-t border-line px-1 pt-1.5">
                <button
                  type="button"
                  onClick={() => {
                    update({ segment: undefined, sort: undefined, dir: undefined });
                    close();
                  }}
                  className="h-8 w-full rounded-md px-2 text-left text-[13.5px] text-ink-2 hover:bg-hover"
                >
                  Reset filters
                </button>
              </div>
            </>
          )}
        </FilterButton>
        <SearchBox value={search} onChange={(v) => update({ search: v || undefined })} placeholder="Search name or phone" />
      </Toolbar>

      {list.loading && !list.data ? (
        <LoadingState />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={list.reload} />
      ) : !rows.length ? (
        search || segment ? (
          <EmptyState title="No matching customers" description="Try a different search or filter." />
        ) : (
          <EmptyState title="No customers yet" description="Add your first customer to start taking orders." action={<ButtonLink to="/customers/new">Add customer</ButtonLink>} />
        )
      ) : (
        <>
          <DataTable
            label="Customers"
            rows={rows}
            columns={COLUMNS}
            rowKey={(c) => c.id}
            hidden={hidden}
            selected={selected}
            onSelectedChange={setSelected}
            sort={{ key: sort, dir }}
            onSort={onSort}
            onRowClick={(c) => navigate(`/customers/${c.id}`)}
            dim={list.loading}
          />
          <Pagination page={page} pageSize={PAGE_SIZE} total={list.data!.total} onChange={(p) => update({ page: String(p) })} />
        </>
      )}
    </>
  );
}
