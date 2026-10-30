import { Archive, ArchiveRestore, PackagePlus, Pencil } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { productsApi } from '../../api/endpoints';
import { Stat, StatStrip } from '../../components/charts/StatStrip';
import { formatStock, StockBadge, StockEntryModal } from '../../components/products/ProductParts';
import BackButton from '../../components/ui/BackButton';
import Button, { ButtonLink } from '../../components/ui/Button';
import { SectionHeader } from '../../components/ui/Card';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { PageTop } from '../../components/ui/Tabs';
import { useToast } from '../../context/ToastContext';
import { formatDateTime } from '../../lib/date';
import { useAsync } from '../../lib/hooks';
import { formatINR } from '../../lib/money';
import type { StockMovementKind } from '../../types';

const KIND_LABEL: Record<StockMovementKind, string> = {
  opening: 'Opening stock',
  receipt: 'Stock received',
  adjustment: 'Adjustment',
  stocktake: 'Stock count',
  write_off: 'Written off',
  sale: 'Sold',
  sale_reversal: 'Returned to stock',
};

export default function ProductDetailPage() {
  const { id = '' } = useParams();
  const toast = useToast();
  const product = useAsync(() => productsApi.get(id), [id]);
  const [stockOpen, setStockOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (product.loading && !product.data) return <LoadingState />;
  if (product.error || !product.data) {
    const notFound = product.error instanceof ApiError && product.error.status === 404;
    return notFound ? (
      <EmptyState title="Product not found" action={<ButtonLink to="/products">Back to products</ButtonLink>} />
    ) : (
      <ErrorState error={product.error ?? 'Not found'} onRetry={product.reload} />
    );
  }
  const p = product.data;

  const toggleActive = async () => {
    setBusy(true);
    try {
      product.setData(await productsApi.setActive(p.id, !p.active));
      toast('success', p.active ? `${p.name} archived. It no longer appears when picking items.` : `${p.name} restored`);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Could not update the product');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageTop
        leading={<BackButton to="/products" label="Back to products" />}
        title={p.name}
        actions={
          <>
            <Button variant="ghost" onClick={toggleActive} loading={busy}>
              {p.active ? <Archive size={15} /> : <ArchiveRestore size={15} />} {p.active ? 'Archive' : 'Restore'}
            </Button>
            <ButtonLink to={`/products/${p.id}/edit`} variant="secondary">
              <Pencil size={14} /> Edit
            </ButtonLink>
            {p.trackStock && (
              <Button onClick={() => setStockOpen(true)}>
                <PackagePlus size={15} /> Update stock
              </Button>
            )}
          </>
        }
      />

      <StatStrip page="product">
        <Stat label="In stock" value={p.trackStock ? formatStock(p.stockMilli, p.unit) : 'Not tracked'} visual={<StockBadge product={p} />} />
        <Stat label="Selling price" value={formatINR(p.pricePaise)} suffix={`per ${p.unit}`} />
        <Stat label="Cost price" value={p.costPaise != null ? formatINR(p.costPaise) : '—'} suffix={p.costPaise != null ? `per ${p.unit}` : undefined} />
        <Stat label="Warn at" value={p.trackStock && p.lowStockMilli != null ? formatStock(p.lowStockMilli, p.unit) : '—'} />
      </StatStrip>

      {(p.sku || p.category) && (
        <p className="border-b border-line px-4 py-3 text-[13.5px] text-ink-2 sm:px-6">{[p.sku && `SKU ${p.sku}`, p.category].filter(Boolean).join(' · ')}</p>
      )}

      <SectionHeader title="Stock history" />
      {!p.movements.length ? (
        <p className="px-4 py-6 text-[13.5px] text-ink-3 sm:px-6">
          {p.trackStock ? 'No stock changes yet. Use “Update stock” to add what you have.' : 'Stock is not tracked for this product.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-[14px]">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-[0.06em] text-ink-3">
                <th className="h-11 pl-4 pr-3 font-medium sm:pl-6">When</th>
                <th className="px-3 font-medium">What</th>
                <th className="px-3 text-right font-medium">Change</th>
                <th className="pl-3 pr-4 text-right font-medium sm:pr-6">Stock after</th>
              </tr>
            </thead>
            <tbody>
              {p.movements.map((m) => (
                <tr key={m.id} className="border-b border-line last:border-0">
                  <td className="whitespace-nowrap py-2.5 pl-4 pr-3 align-top text-ink-2 sm:pl-6">{formatDateTime(m.createdAt)}</td>
                  <td className="px-3 py-2.5 align-top">
                    <span className="text-ink">{KIND_LABEL[m.kind]}</span>
                    {m.orderId && m.orderNumber ? (
                      <>
                        {' · '}
                        <Link to={`/orders/${m.orderId}`} className="hover:underline">
                          {m.orderNumber}
                        </Link>
                      </>
                    ) : null}
                    {m.note && m.note !== m.orderNumber ? (
                      <span className="block text-[12.5px] text-ink-3">{m.note}</span>
                    ) : null}
                    {m.createdByName && <span className="block text-[12.5px] text-ink-3">by {m.createdByName}</span>}
                  </td>
                  <td className={`px-3 py-2.5 text-right align-top tabular-nums ${m.qtyMilli < 0 ? 'text-danger' : 'text-success-text'}`}>
                    {m.qtyMilli > 0 ? '+' : '−'}
                    {formatStock(Math.abs(m.qtyMilli), p.unit)}
                  </td>
                  <td className="py-2.5 pl-3 pr-4 text-right align-top tabular-nums text-ink sm:pr-6">{formatStock(m.balanceMilli, p.unit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <StockEntryModal
        open={stockOpen}
        product={p}
        onClose={() => setStockOpen(false)}
        onSaved={(updated) => {
          product.setData(updated);
          setStockOpen(false);
          toast('success', `Stock is now ${formatStock(updated.stockMilli, updated.unit)}`);
        }}
      />
    </>
  );
}
