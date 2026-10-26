import { Download, X } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { dashboardApi, ordersApi } from '../../api/endpoints';
import { Sparkline, Stat, StatStrip, TickGauge } from '../../components/charts/StatStrip';
import BulkDelete from '../../components/data/BulkDelete';
import { CustomizeButton, FilterButton, FilterOptions, SearchBox, Toolbar, useHiddenColumns } from '../../components/data/Toolbar';
import OrdersTable, { orderColumns } from '../../components/orders/OrdersTable';
import { ORDER_STATUS_LABEL, PAYMENT_STATUS_LABEL } from '../../components/ui/Badge';
import Button, { ButtonLink } from '../../components/ui/Button';
import { controlClass } from '../../components/ui/Field';
import { MenuLabel } from '../../components/ui/Popover';
import Pagination from '../../components/ui/Pagination';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { PageTop } from '../../components/ui/Tabs';
import { downloadCsv, rupees } from '../../lib/csv';
import { useAsync } from '../../lib/hooks';
import { formatINRCompact } from '../../lib/money';
import type { OrderListItem, OrderStatus, PaymentStatus } from '../../types';

const PAGE_SIZE = 25;
type SortKey = 'date' | 'total' | 'number';

export default function OrderListPage() {
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? '';
  const status = get('status') as OrderStatus | '';
  const paymentStatus = get('paymentStatus') as PaymentStatus | '';
  const sort = (get('sort') as SortKey) || 'date';
  const dir = (get('dir') as 'asc' | 'desc') || 'desc';
  const page = Number(get('page')) || 1;
  const [selected, setSelected] = useState<Set<number | string>>(new Set());
  const { hidden, toggle } = useHiddenColumns('crm.cols.orders');

  const update = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };

  const analytics = useAsync(() => dashboardApi.analytics(30), []);
  const counts = useAsync(() => dashboardApi.summary(), []);
  const list = useAsync(
    () =>
      ordersApi.list({
        search: get('search') || undefined,
        status,
        paymentStatus,
        from: get('from') || undefined,
        to: get('to') || undefined,
        sort,
        dir,
        page,
        pageSize: PAGE_SIZE,
      }),
    [params.toString()],
  );

  const a = analytics.data;
  const rows = list.data?.data ?? [];
  const filterCount = [paymentStatus, get('from'), get('to')].filter(Boolean).length;
  const orders30 = a?.summary.orders ?? 0;
  const pending = (a?.payment ?? []).filter((p) => p.status !== 'paid').reduce((t, p) => t + p.orders, 0);
  const cancelled30 = a?.status.find((x) => x.status === 'cancelled')?.orders ?? 0;
  const all30 = (a?.status ?? []).reduce((t, x) => t + x.orders, 0);
  const today = a?.daily[a.daily.length - 1];

  const exportCsv = (data: OrderListItem[]) =>
    downloadCsv(`orders-${new Date().toISOString().slice(0, 10)}.csv`, data, [
      { header: 'Order', value: (o) => o.orderNumber },
      { header: 'Date', value: (o) => o.orderDate },
      { header: 'Customer', value: (o) => o.customerName },
      { header: 'Phone', value: (o) => o.customerPhone },
      { header: 'Items', value: (o) => o.itemCount },
      { header: 'Status', value: (o) => ORDER_STATUS_LABEL[o.status] },
      { header: 'Payment', value: (o) => PAYMENT_STATUS_LABEL[o.paymentStatus] },
      { header: 'Total (Rs)', value: (o) => rupees(o.totalPaise) },
      { header: 'Paid (Rs)', value: (o) => rupees(o.amountPaidPaise) },
    ]);

  return (
    <>
      <PageTop
        tabs={[
          { key: '', label: 'All orders' },
          { key: 'open', label: 'Open', count: counts.data?.openOrders },
          { key: 'completed', label: 'Completed' },
          { key: 'cancelled', label: 'Cancelled' },
        ]}
        value={status}
        onChange={(k) => {
          setSelected(new Set());
          update({ status: k || undefined });
        }}
        actions={<ButtonLink to="/orders/new">New order</ButtonLink>}
      />

      {a && (
        <StatStrip>
          <Stat
            label="Orders today"
            value={String(today?.orders ?? 0)}
            visual={<Sparkline values={a.daily.map((d) => d.orders)} label="Daily orders, last 30 days" />}
          />
          <Stat
            label="Sales today"
            value={formatINRCompact(today?.revenuePaise ?? 0)}
            visual={<Sparkline values={a.daily.map((d) => d.revenuePaise)} label="Daily revenue, last 30 days" />}
          />
          <Stat
            label="Open orders"
            value={String(counts.data?.openOrders ?? '—')}
            suffix="to fulfil"
            visual={<TickGauge value={orders30 ? (counts.data?.openOrders ?? 0) / orders30 : 0} label="Open orders as a share of the last 30 days" />}
          />
          <Stat
            label="Payment pending"
            value={String(pending)}
            suffix={`${orders30 ? Math.round((pending / orders30) * 100) : 0}%`}
            visual={<TickGauge value={orders30 ? pending / orders30 : 0} label="Unpaid or partially paid orders, last 30 days" />}
          />
          <Stat
            label="Cancelled · 30d"
            value={String(cancelled30)}
            suffix={`${all30 ? Math.round((cancelled30 / all30) * 100) : 0}%`}
            visual={<TickGauge value={all30 ? cancelled30 / all30 : 0} reference={0.05} label="Cancelled share of orders, last 30 days" />}
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
                noun={['order', 'orders']}
                remove={(id) => ordersApi.remove(id)}
                onDone={() => {
                  setSelected(new Set());
                  list.reload();
                  analytics.reload();
                  counts.reload();
                }}
                warning="Each order is deleted permanently with its items and all its invoices. Order and invoice numbers are not reused. This can't be undone."
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
              <CustomizeButton columns={orderColumns(true).filter((c) => c.optional)} hidden={hidden} onToggle={toggle} />
            </>
          )
        }
      >
        <FilterButton count={filterCount}>
          {(close) => (
            <>
              <FilterOptions
                label="Payment"
                value={paymentStatus}
                options={(Object.keys(PAYMENT_STATUS_LABEL) as PaymentStatus[]).map((k) => ({ value: k, label: PAYMENT_STATUS_LABEL[k] }))}
                onChange={(v) => update({ paymentStatus: v || undefined })}
              />
              <div className="px-1 pb-2">
                <MenuLabel>Date range</MenuLabel>
                <div className="grid grid-cols-2 gap-2 px-1">
                  <input type="date" aria-label="From date" value={get('from')} onChange={(e) => update({ from: e.target.value || undefined })} className={controlClass(false, 'h-8 px-2 text-[13px]')} />
                  <input type="date" aria-label="To date" value={get('to')} onChange={(e) => update({ to: e.target.value || undefined })} className={controlClass(false, 'h-8 px-2 text-[13px]')} />
                </div>
              </div>
              <div className="border-t border-line px-1 pt-1.5">
                <button
                  type="button"
                  onClick={() => {
                    update({ paymentStatus: undefined, from: undefined, to: undefined });
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
        <SearchBox value={get('search')} onChange={(v) => update({ search: v || undefined })} placeholder="Search order no, customer or phone" />
      </Toolbar>

      {list.loading && !list.data ? (
        <LoadingState />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={list.reload} />
      ) : !rows.length ? (
        filterCount || status || get('search') ? (
          <EmptyState title="No orders match" description="Try a different search or filter." />
        ) : (
          <EmptyState title="No orders yet" action={<ButtonLink to="/orders/new">New order</ButtonLink>} />
        )
      ) : (
        <>
          <OrdersTable
            orders={rows}
            hidden={hidden}
            sort={{ key: sort, dir }}
            onSort={(k) => update({ sort: k, dir: sort === k ? (dir === 'asc' ? 'desc' : 'asc') : 'desc' })}
            selected={selected}
            onSelectedChange={setSelected}
            dim={list.loading}
          />
          <Pagination page={page} pageSize={PAGE_SIZE} total={list.data!.total} onChange={(p) => update({ page: String(p) })} />
        </>
      )}
    </>
  );
}
