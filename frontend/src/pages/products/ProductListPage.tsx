import { useNavigate, useSearchParams } from 'react-router-dom';
import { productsApi } from '../../api/endpoints';
import DataTable, { Column } from '../../components/data/DataTable';
import { SearchBox, Toolbar } from '../../components/data/Toolbar';
import { formatStock, StockBadge } from '../../components/products/ProductParts';
import { ButtonLink } from '../../components/ui/Button';
import Pagination from '../../components/ui/Pagination';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { PageTop } from '../../components/ui/Tabs';
import { useAsync } from '../../lib/hooks';
import { formatINR } from '../../lib/money';
import type { Product } from '../../types';

const PAGE_SIZE = 25;
type Status = 'active' | 'low' | 'archived';

const COLUMNS: Column<Product>[] = [
  {
    key: 'name',
    header: 'Product',
    cell: (p) => (
      <span className="block min-w-0">
        <span className="block truncate text-ink">{p.name}</span>
        {(p.sku || p.category) && <span className="block truncate text-[12.5px] text-ink-3">{[p.sku, p.category].filter(Boolean).join(' · ')}</span>}
      </span>
    ),
  },
  { key: 'price', header: 'Price', align: 'right', cell: (p) => <span className="tabular-nums">{formatINR(p.pricePaise)} <span className="text-ink-3">/ {p.unit}</span></span> },
  {
    key: 'stock',
    header: 'In stock',
    align: 'right',
    cell: (p) =>
      p.trackStock ? (
        <span className={`tabular-nums ${p.stockMilli < 0 ? 'text-[#b42318]' : 'text-ink'}`}>{formatStock(p.stockMilli, p.unit)}</span>
      ) : (
        <span className="text-ink-3">—</span>
      ),
  },
  { key: 'status', header: 'Status', hideBelow: 'sm', cell: (p) => <StockBadge product={p} /> },
];

export default function ProductListPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = (params.get('status') as Status) || 'active';
  const search = params.get('search') ?? '';
  const page = Number(params.get('page')) || 1;
  const update = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };

  const list = useAsync(() => productsApi.list({ status, search: search || undefined, page, pageSize: PAGE_SIZE }), [status, search, page]);
  const lowCount = useAsync(() => productsApi.lowStockCount(), []);
  const rows = list.data?.data ?? [];

  return (
    <>
      <PageTop
        tabs={[
          { key: 'active', label: 'All products' },
          { key: 'low', label: 'Low stock', count: lowCount.data?.count || undefined },
          { key: 'archived', label: 'Archived' },
        ]}
        value={status}
        onChange={(k) => update({ status: k === 'active' ? undefined : k })}
        actions={<ButtonLink to="/products/new">Add product</ButtonLink>}
      />
      <Toolbar>
        <SearchBox value={search} onChange={(v) => update({ search: v || undefined })} placeholder="Search name, SKU or category" />
      </Toolbar>

      {list.loading && !list.data ? (
        <LoadingState />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={list.reload} />
      ) : !rows.length ? (
        search ? (
          <EmptyState title="No matching products" description="Try a different search." />
        ) : status === 'low' ? (
          <EmptyState title="Nothing is low on stock" description="Products show here when they reach their warning level or run out." />
        ) : status === 'archived' ? (
          <EmptyState title="No archived products" />
        ) : (
          <EmptyState
            title="No products yet"
            description="Add the things you sell to pick them quickly in orders and keep track of stock. Typing item names by hand still works."
            action={<ButtonLink to="/products/new">Add product</ButtonLink>}
          />
        )
      ) : (
        <>
          <DataTable label="Products" rows={rows} columns={COLUMNS} rowKey={(p) => p.id} onRowClick={(p) => navigate(`/products/${p.id}`)} dim={list.loading} />
          <Pagination page={page} pageSize={PAGE_SIZE} total={list.data!.total} onChange={(p) => update({ page: String(p) })} />
        </>
      )}
    </>
  );
}
