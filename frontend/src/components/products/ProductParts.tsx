import { FormEvent, useState } from 'react';
import { ApiError } from '../../api/client';
import { productsApi, ProductPayload } from '../../api/endpoints';
import { isValidMoney, paiseToInput } from '../../lib/money';
import { uuid } from '../../lib/uuid';
import { PRODUCT_UNITS, type Product, type ProductDetail, type ProductUnit } from '../../types';
import { Pill } from '../ui/Badge';
import Button from '../ui/Button';
import { SelectField, TextField } from '../ui/Field';
import { Modal } from '../ui/Modal';
import { Alert } from '../ui/States';

const QTY_RE = /^\d{1,7}(\.\d{1,3})?$/;

/** 2500 (milli) + 'kg' -> "2.5 kg" */
export const formatStock = (milli: number, unit: string) => `${Number((milli / 1000).toFixed(3))} ${unit}`;
const milliToInput = (milli: number | null) => (milli === null ? '' : String(Number((milli / 1000).toFixed(3))));

export function StockBadge({ product }: { product: Product }) {
  if (!product.active) return <Pill tone="gray">Archived</Pill>;
  if (!product.trackStock) return <Pill tone="gray">Not tracked</Pill>;
  if (product.stockMilli < 0) return <Pill tone="red">Below zero</Pill>;
  if (product.stockMilli === 0) return <Pill tone="red">Out of stock</Pill>;
  if (product.low) return <Pill tone="amber">Low stock</Pill>;
  return <Pill tone="green">In stock</Pill>;
}

interface FormValues {
  name: string;
  sku: string;
  category: string;
  unit: ProductUnit;
  price: string;
  cost: string;
  trackStock: boolean;
  lowStockAt: string;
  openingStock: string;
}

/** Create (with opening stock) and edit share this form. */
export function ProductForm({
  product,
  submitLabel,
  onSaved,
  onCancel,
}: {
  product?: Product;
  submitLabel: string;
  onSaved: (p: ProductDetail) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState<FormValues>({
    name: product?.name ?? '',
    sku: product?.sku ?? '',
    category: product?.category ?? '',
    unit: product?.unit ?? 'pcs',
    price: product ? paiseToInput(product.pricePaise) : '',
    cost: product?.costPaise != null ? paiseToInput(product.costPaise) : '',
    trackStock: product?.trackStock ?? true,
    lowStockAt: milliToInput(product?.lowStockMilli ?? null),
    openingStock: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof FormValues) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const err: Record<string, string> = {};
    if (!v.name.trim()) err.name = 'Name is required';
    if (!v.price.trim() || !isValidMoney(v.price.trim())) err.price = 'Enter the selling price, e.g. 120 or 99.50';
    if (v.cost.trim() && !isValidMoney(v.cost.trim())) err.cost = 'Enter a valid amount';
    if (v.trackStock && v.lowStockAt.trim() && !QTY_RE.test(v.lowStockAt.trim())) err.lowStockAt = 'Enter a quantity, e.g. 5';
    if (!product && v.trackStock && v.openingStock.trim() && !QTY_RE.test(v.openingStock.trim())) err.openingStock = 'Enter a quantity, e.g. 20';
    setErrors(err);
    if (Object.keys(err).length) {
      setFormError('Please fix the highlighted fields.');
      return;
    }
    setFormError(null);
    setBusy(true);
    const payload: ProductPayload = {
      name: v.name.trim(),
      sku: v.sku.trim() || null,
      category: v.category.trim() || null,
      unit: v.unit,
      price: v.price.trim(),
      cost: v.cost.trim() || null,
      trackStock: v.trackStock,
      lowStockAt: v.trackStock ? v.lowStockAt.trim() || null : null,
    };
    try {
      onSaved(
        product
          ? await productsApi.update(product.id, payload)
          : await productsApi.create({ ...payload, openingStock: v.trackStock ? v.openingStock.trim() || null : null }),
      );
    } catch (e2) {
      if (e2 instanceof ApiError) {
        setErrors(e2.fieldErrors);
        setFormError(e2.message);
      } else setFormError('Could not save. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      {formError && <Alert tone="error">{formError}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Name" required value={v.name} onChange={set('name')} error={errors.name} maxLength={120} autoFocus={!product} />
        <TextField label="SKU / code" value={v.sku} onChange={set('sku')} error={errors.sku} maxLength={40} hint="Optional, e.g. a barcode or your own code" />
        <TextField label="Category" value={v.category} onChange={set('category')} error={errors.category} maxLength={60} hint="Optional, e.g. Grains" />
        <SelectField label="Sold by" value={v.unit} onChange={(e) => setV({ ...v, unit: e.target.value as ProductUnit })}>
          {PRODUCT_UNITS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </SelectField>
        <TextField label={`Selling price per ${v.unit} (₹)`} required inputMode="decimal" value={v.price} onChange={set('price')} error={errors.price} />
        <TextField
          label={`Cost price per ${v.unit} (₹)`}
          inputMode="decimal"
          value={v.cost}
          onChange={set('cost')}
          error={errors.cost}
          hint="Optional, for your reference only"
        />
      </div>

      <div className="space-y-4 rounded-xl border border-line p-4">
        <label className="flex cursor-pointer items-start gap-3 text-[14px]">
          <input type="checkbox" className="mt-1 h-4 w-4 accent-[#171717]" checked={v.trackStock} onChange={(e) => setV({ ...v, trackStock: e.target.checked })} />
          <span>
            <span className="text-ink">Track stock</span>
            <span className="mt-0.5 block text-[13px] text-ink-3">Orders take stock automatically; cancelling or deleting an order puts it back.</span>
          </span>
        </label>
        {v.trackStock && (
          <div className="grid gap-4 sm:grid-cols-2">
            {!product && (
              <TextField
                label={`Stock in hand now (${v.unit})`}
                inputMode="decimal"
                value={v.openingStock}
                onChange={set('openingStock')}
                error={errors.openingStock}
                hint="Optional. You can add stock later."
              />
            )}
            <TextField
              label={`Warn when stock is at or below (${v.unit})`}
              inputMode="decimal"
              value={v.lowStockAt}
              onChange={set('lowStockAt')}
              error={errors.lowStockAt}
              hint="Optional. Below zero always warns."
            />
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={busy}>
          {submitLabel}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

type StockKind = 'receipt' | 'write_off' | 'stocktake';
const KIND_TEXT: Record<StockKind, { tab: string; qty: string; save: string; hint: string }> = {
  receipt: { tab: 'Stock received', qty: 'Quantity received', save: 'Add stock', hint: 'Adds to the stock.' },
  write_off: { tab: 'Write off', qty: 'Quantity to remove', save: 'Remove stock', hint: 'Damaged, expired, lost or used in the shop.' },
  stocktake: { tab: 'Stock count', qty: 'Quantity you counted', save: 'Save count', hint: 'Sets the stock to what you counted and records the difference.' },
};

/** Stock received, written off, or counted. */
export function StockEntryModal({ open, product, onClose, onSaved }: { open: boolean; product: Product; onClose: () => void; onSaved: (p: ProductDetail) => void }) {
  const [kind, setKind] = useState<StockKind>('receipt');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [key, setKey] = useState(uuid());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setKind('receipt');
      setQty('');
      setNote('');
      setKey(uuid());
      setError(null);
    }
  }

  const save = async () => {
    const q = qty.trim();
    if (!QTY_RE.test(q) || (kind !== 'stocktake' && Number(q) === 0)) return setError('Enter a quantity, e.g. 12 or 2.5');
    setBusy(true);
    setError(null);
    try {
      onSaved(await productsApi.addStock(product.id, { kind, qty: q, note: note.trim() || null, idempotencyKey: key }));
    } catch (err) {
      setError(err instanceof ApiError ? (err.fieldErrors.qty ?? err.message) : 'Could not save. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const t = KIND_TEXT[kind];
  return (
    <Modal
      open={open}
      title={`Stock: ${product.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} loading={busy}>
            {t.save}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div role="radiogroup" aria-label="What happened" className="flex flex-wrap gap-1.5">
          {(Object.keys(KIND_TEXT) as StockKind[]).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => {
                setKind(k);
                setError(null);
              }}
              className={`h-8 rounded-md border px-3 text-[13px] ${kind === k ? 'border-ink bg-ink text-white' : 'border-line text-ink-2 hover:bg-hover'}`}
            >
              {KIND_TEXT[k].tab}
            </button>
          ))}
        </div>
        <p className="text-[13.5px] text-ink-2">
          In stock now: <span className="text-ink">{formatStock(product.stockMilli, product.unit)}</span>. {t.hint}
        </p>
        <TextField label={`${t.qty} (${product.unit})`} inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} error={error ?? undefined} autoFocus />
        <TextField
          label="Note (optional)"
          placeholder={kind === 'receipt' ? 'e.g. supplier, bill no.' : kind === 'write_off' ? 'e.g. damaged in rain' : 'e.g. monthly count'}
          value={note}
          maxLength={300}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
    </Modal>
  );
}
