import { BookOpen, Upload } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { productsApi } from '../../api/endpoints';
import CatalogueModal from '../../components/catalogue/CatalogueModal';
import DataTable, { Column } from '../../components/data/DataTable';
import ImportCsvModal from '../../components/data/ImportCsvModal';
import { SearchBox, Toolbar } from '../../components/data/Toolbar';
import { formatStock, StockBadge } from '../../components/products/ProductParts';
import Button, { ButtonLink } from '../../components/ui/Button';
import Pagination from '../../components/ui/Pagination';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { PageTop } from '../../components/ui/Tabs';
import { ImportColumn } from '../../lib/csv';
import { useAsync } from '../../lib/hooks';
import { formatINR } from '../../lib/money';
import type { Product } from '../../types';

const PAGE_SIZE = 25;
type Status = 'active' | 'low' | 'archived';
const IMPORT_COLUMNS: ImportColumn[] = [
  { key: 'id', header: 'ID', aliases: ['product id'] },
  { key: 'name', header: 'Name', required: true },
  { key: 'sku', header: 'SKU', aliases: ['code', 'barcode'] },
  { key: 'category', header: 'Category' },
  { key: 'unit', header: 'Unit' },
  { key: 'price', header: 'Price', aliases: ['selling price', 'sale price', 'price (rs)'], required: true },
  { key: 'cost', header: 'Cost', aliases: ['cost price', 'cost (rs)'] },
  { key: 'trackStock', header: 'Track stock' },
  { key: 'lowStockAt', header: 'Low stock at', aliases: ['low stock level', 'warning level', 'reorder level'] },
  { key: 'openingStock', header: 'Opening stock', aliases: ['stock', 'quantity'] },
];

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
        <span className={`tabular-nums ${p.stockMilli < 0 ? 'text-danger' : 'text-ink'}`}>{formatStock(p.stockMilli, p.unit)}</span>
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
  const [importing, setImporting] = useState(false);
  const [catalogueOpen, setCatalogueOpen] = useState(false);
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
        actions={
          <>
            <Button variant="secondary" onClick={() => setCatalogueOpen(true)}>
              <BookOpen size={15} /> Catalogue
            </Button>
            <ButtonLink to="/products/new">Add product</ButtonLink>
          </>
        }
      />
      <Toolbar
        right={
          <button type="button" onClick={() => setImporting(true)} className="hidden items-center gap-1.5 text-[14px] text-ink-2 hover:text-ink sm:inline-flex">
            <Upload size={16} strokeWidth={1.75} /> Import
          </button>
        }
      >
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
      <CatalogueModal
        open={catalogueOpen}
        onClose={() => setCatalogueOpen(false)}
        productCount={status === 'active' && !search ? (list.data?.total ?? null) : null}
      />
      <ImportCsvModal
        open={importing}
        onClose={() => setImporting(false)}
        title="Import products"
        noun={['product', 'products']}
        columns={IMPORT_COLUMNS}
        example={{ id: '', name: 'Basmati rice', sku: 'RICE-5', category: 'Grocery', unit: 'kg', price: '95', cost: '80', trackStock: 'yes', lowStockAt: '10', openingStock: '50' }}
        templateName="products-template.csv"
        help={
          <>
            Columns: Name and Price (required), SKU, Category, Unit (pcs, kg, g, l, ml, m, box, pack, dozen, pair, set), Cost, Track stock (yes/no), Low
            stock at, Opening stock and ID. A row with a product's ID updates that product, but never its stock; leave ID blank to add a new one. The
            ID is the number at the end of the product's page address.
          </>
        }
        run={productsApi.importRows}
        onDone={() => {
          list.reload();
          lowCount.reload();
        }}
      />
    </>
  );
}
