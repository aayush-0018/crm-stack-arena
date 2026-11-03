import { Minus, Plus, Search, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ApiError } from '../../api/client';
import { ordersApi, productsApi } from '../../api/endpoints';
import { useToast } from '../../context/ToastContext';
import { useAsync } from '../../lib/hooks';
import { formatINR, paiseToInput } from '../../lib/money';
import type { Product } from '../../types';
import Button from '../ui/Button';
import { controlClass } from '../ui/Field';
import { Modal } from '../ui/Modal';
import Spinner from '../ui/Spinner';
import ProductThumb from '../products/ProductThumb';

interface Line {
  key: string;
  productId: number | null;
  itemName: string;
  quantity: number;
  unitPricePaise: number;
}

/** Change what's on a table's order: adjust or remove lines, and add more from the catalogue. */
export default function TableOrderEditor({ orderId, onClose, onSaved }: { orderId: number; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const order = useAsync(() => ordersApi.get(orderId), [orderId]);
  const products = useAsync(() => productsApi.list({ status: 'active', pageSize: 100 }), []);
  const [lines, setLines] = useState<Line[] | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const o = order.data;
  useEffect(() => {
    if (o && !lines)
      setLines(
        o.items.map((it) => ({
          key: `${it.position}`,
          productId: it.productId,
          itemName: it.itemName,
          quantity: Number(it.quantity),
          unitPricePaise: it.unitPricePaise,
        })),
      );
  }, [o, lines]);

  const list = products.data?.data ?? [];
  const categories = useMemo(() => [...new Set(list.map((p) => p.category).filter((c): c is string => !!c))].sort(), [list]);
  const shown = list.filter(
    (p) => (!category || p.category === category) && (!search.trim() || p.name.toLowerCase().includes(search.trim().toLowerCase())),
  );

  const add = (p: Product) =>
    setLines((ls) => {
      const cur = ls ?? [];
      const at = cur.findIndex((l) => l.productId === p.id && l.unitPricePaise === p.pricePaise);
      if (at >= 0) return cur.map((l, i) => (i === at ? { ...l, quantity: l.quantity + 1 } : l));
      return [...cur, { key: `p${p.id}-${Date.now()}`, productId: p.id, itemName: p.name, quantity: 1, unitPricePaise: p.pricePaise }];
    });
  const change = (key: string, by: number) =>
    setLines((ls) => (ls ?? []).map((l) => (l.key === key ? { ...l, quantity: Math.max(1, +(l.quantity + by).toFixed(3)) } : l)));
  const drop = (key: string) => setLines((ls) => (ls ?? []).filter((l) => l.key !== key));

  const subtotal = (lines ?? []).reduce((s, l) => s + Math.round(l.quantity * l.unitPricePaise), 0);
  const total = Math.max(0, subtotal - (o?.discountPaise ?? 0));

  const save = async () => {
    if (!o || !lines) return;
    if (!lines.length) return setError('Keep at least one item. To remove the whole order, delete or cancel it.');
    setSaving(true);
    setError(null);
    try {
      await ordersApi.update(o.id, {
        items: lines.map((l) => ({ productId: l.productId, itemName: l.itemName, quantity: String(l.quantity), unitPrice: paiseToInput(l.unitPricePaise) })),
        discount: paiseToInput(o.discountPaise),
        notes: o.notes,
        orderDate: o.orderDate,
      });
      toast('success', `${o.orderNumber} updated`);
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save the order. Check the connection.');
    } finally {
      setSaving(false);
    }
  };

  const locked = o && o.returns.length > 0 ? 'Items were returned on this order, so it can no longer be changed.' : null;

  return (
    <Modal
      open
      size="xl"
      title={o ? `Edit ${o.orderNumber}` : 'Edit order'}
      onClose={saving ? () => undefined : onClose}
      footer={
        <>
          <span className="mr-auto text-[14px] text-ink-2">
            Total <span className="font-medium tabular-nums text-ink">{formatINR(total)}</span>
            {o && o.discountPaise > 0 && <span className="ml-1.5 text-[12.5px] text-ink-3">after {formatINR(o.discountPaise)} off</span>}
          </span>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving} disabled={!lines || !!locked}>
            Save changes
          </Button>
        </>
      }
    >
      {order.error ? (
        <p className="text-[13.5px] text-danger">{order.error.message}</p>
      ) : !o || !lines ? (
        <div className="flex justify-center py-10">
          <Spinner className="h-5 w-5" />
        </div>
      ) : (
        <div className="space-y-5">
          {(error || locked) && <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-[13.5px] text-danger-strong">{error ?? locked}</p>}

          <section aria-label="On the order">
            <p className="mb-2 text-[12px] font-medium uppercase tracking-[0.06em] text-ink-3">On the order</p>
            {lines.length === 0 ? (
              <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-[13px] text-ink-3">No items. Add some from the catalogue below.</p>
            ) : (
              <ul className="divide-y divide-line rounded-lg border border-line">
                {lines.map((l) => (
                  <li key={l.key} className="flex items-center gap-3 px-3 py-2 text-[14px]">
                    <span className="min-w-0 flex-1 truncate text-ink">{l.itemName}</span>
                    <span className="flex items-center gap-1">
                      <button type="button" aria-label={`One less ${l.itemName}`} disabled={!!locked || l.quantity <= 1} onClick={() => change(l.key, -1)} className="flex h-7 w-7 items-center justify-center rounded-md border border-line text-ink-2 hover:bg-hover disabled:opacity-40">
                        <Minus size={13} />
                      </button>
                      <span className="w-9 text-center tabular-nums">{l.quantity}</span>
                      <button type="button" aria-label={`One more ${l.itemName}`} disabled={!!locked} onClick={() => change(l.key, 1)} className="flex h-7 w-7 items-center justify-center rounded-md border border-line text-ink-2 hover:bg-hover disabled:opacity-40">
                        <Plus size={13} />
                      </button>
                    </span>
                    <span className="w-20 text-right tabular-nums text-ink-2">{formatINR(Math.round(l.quantity * l.unitPricePaise))}</span>
                    <button type="button" aria-label={`Remove ${l.itemName}`} disabled={!!locked} onClick={() => drop(l.key)} className="text-ink-3 hover:text-danger disabled:opacity-40">
                      <Trash2 size={15} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {!locked && (
            <section aria-label="Catalogue">
              <p className="mb-2 text-[12px] font-medium uppercase tracking-[0.06em] text-ink-3">Add from the catalogue</p>
              <div className="relative">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-4" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products" aria-label="Search products" className={controlClass(false, 'h-9 pl-9')} />
              </div>
              {categories.length > 1 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {['', ...categories].map((c) => (
                    <button
                      key={c || 'all'}
                      type="button"
                      onClick={() => setCategory(c)}
                      className={`h-7 rounded-full border px-3 text-[12.5px] ${category === c ? 'border-ink bg-ink text-on-ink' : 'border-line text-ink-2 hover:bg-hover'}`}
                    >
                      {c || 'All'}
                    </button>
                  ))}
                </div>
              )}
              {products.loading && !products.data ? (
                <div className="flex justify-center py-6">
                  <Spinner className="h-5 w-5" />
                </div>
              ) : shown.length === 0 ? (
                <p className="py-6 text-center text-[13px] text-ink-3">No products found.</p>
              ) : (
                <div className="mt-3 grid max-h-[320px] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
                  {shown.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => add(p)}
                      className="flex items-center gap-2.5 rounded-lg border border-line p-2 text-left hover:border-ink-4 hover:bg-wash"
                    >
                      <ProductThumb product={p} size={40} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] text-ink">{p.name}</span>
                        <span className="block text-[12.5px] tabular-nums text-ink-3">{formatINR(p.pricePaise)}</span>
                      </span>
                      <Plus size={15} className="shrink-0 text-ink-3" />
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}
