import { KeyboardEvent } from 'react';
import { formatINR, lineTotalPaise, paiseToInput } from '../../lib/money';
import { uuid } from '../../lib/uuid';
import { formatStock } from '../products/ProductParts';
import Button from '../ui/Button';
import ProductPicker from './ProductPicker';

export interface ItemRow {
  key: string;
  itemName: string;
  quantity: string;
  unitPrice: string;
  /** Set when picked from the product list; typing over the name unlinks it. */
  productId?: number | null;
  /** Stock info from when it was picked, for the hint under the line. */
  stock?: { milli: number; unit: string } | null;
}

export const newRow = (): ItemRow => ({ key: uuid(), itemName: '', quantity: '1', unitPrice: '' });

const input = (invalid?: boolean) =>
  `h-9 w-full rounded-lg border bg-surface px-3 text-[14px] text-ink placeholder:text-ink-4 shadow-soft focus:outline-none focus:ring-[3px] ${
    invalid ? 'border-danger-line-2 focus:ring-danger/10' : 'border-line focus:border-ink-4 focus:ring-ink/5'
  }`;

export default function LineItemsEditor({
  rows,
  onChange,
  errors,
  heldStock = {},
}: {
  rows: ItemRow[];
  onChange: (rows: ItemRow[]) => void;
  errors: Record<string, string>;
  /** Editing a saved order: milli-units of each product it already holds, which the edit can reuse. */
  heldStock?: Record<number, number>;
}) {
  const update = (i: number, patch: Partial<ItemRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => onChange(rows.length === 1 ? [newRow()] : rows.filter((_, j) => j !== i));
  const add = () => {
    onChange([...rows, newRow()]);
    // focus the new row's name field after render
    setTimeout(() => {
      const inputs = document.querySelectorAll<HTMLInputElement>('[data-item-name]');
      inputs[inputs.length - 1]?.focus();
    });
  };
  const addOnEnter = (i: number) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (i === rows.length - 1) add();
    }
  };
  const err = (i: number, f: string) => errors[`items.${i}.${f}`];

  return (
    <div>
      {errors.items && <p className="mb-2 text-sm text-danger">{errors.items}</p>}

      <div className="hidden grid-cols-[2rem_minmax(0,1fr)_7rem_8rem_7rem_2.5rem] gap-2 px-1 pb-2 text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3 md:grid">
        <span>#</span>
        <span>Item</span>
        <span>Qty</span>
        <span>Unit price (₹)</span>
        <span className="text-right">Amount</span>
        <span />
      </div>

      <ul className="space-y-3 md:space-y-2">
        {rows.map((r, i) => (
          <li
            key={r.key}
            className="grid grid-cols-2 gap-2 rounded-lg border border-line p-3 md:grid-cols-[2rem_minmax(0,1fr)_7rem_8rem_7rem_2.5rem] md:items-start md:border-0 md:p-0"
          >
            <span className="hidden pt-3 text-sm text-ink-3 md:block">{i + 1}</span>
            <div className="col-span-2 md:col-span-1">
              <ProductPicker
                index={i}
                value={r.itemName}
                invalid={!!err(i, 'itemName')}
                className={input(!!err(i, 'itemName'))}
                onType={(text) => update(i, { itemName: text, productId: null, stock: null })}
                onPick={(p) =>
                  update(i, {
                    itemName: p.name,
                    unitPrice: paiseToInput(p.pricePaise),
                    productId: p.id,
                    stock: p.trackStock ? { milli: p.stockMilli, unit: p.unit } : null,
                  })
                }
              />
              {err(i, 'itemName') && <p className="mt-1 text-xs text-danger">{err(i, 'itemName')}</p>}
              {r.productId ? <StockHint row={r} held={heldStock[r.productId] ?? 0} /> : null}
            </div>
            <div>
              <input
                aria-label={`Item ${i + 1} quantity`}
                inputMode="decimal"
                placeholder="Qty"
                className={input(!!err(i, 'quantity'))}
                value={r.quantity}
                onChange={(e) => update(i, { quantity: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
              />
              {err(i, 'quantity') && <p className="mt-1 text-xs text-danger">{err(i, 'quantity')}</p>}
            </div>
            <div>
              <input
                aria-label={`Item ${i + 1} unit price`}
                inputMode="decimal"
                placeholder="0.00"
                className={input(!!err(i, 'unitPrice'))}
                value={r.unitPrice}
                onChange={(e) => update(i, { unitPrice: e.target.value })}
                onKeyDown={addOnEnter(i)}
              />
              {err(i, 'unitPrice') && <p className="mt-1 text-xs text-danger">{err(i, 'unitPrice')}</p>}
            </div>
            <p className="self-center text-right text-sm font-medium tabular-nums md:pt-3">
              {formatINR(lineTotalPaise(r.quantity, r.unitPrice))}
            </p>
            <button
              type="button"
              onClick={() => remove(i)}
              aria-label={`Remove item ${i + 1}`}
              className="justify-self-end rounded-lg p-2 text-ink-4 hover:bg-danger-bg hover:text-danger"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </button>
          </li>
        ))}
      </ul>

      <Button variant="secondary" size="sm" className="mt-3" onClick={add}>
        + Add item
      </Button>
      <p className="mt-2 text-[12px] text-ink-3">Tip: press Enter in the last price field to add another row.</p>
    </div>
  );
}

/**
 * "From products · 7 kg in stock", or a warning when the line asks for more than that. When editing, the
 * stock this order already holds counts as available (the server checks the same way).
 */
function StockHint({ row, held }: { row: ItemRow; held: number }) {
  if (!row.stock) return <p className="mt-1 text-[12px] text-ink-3">From products</p>;
  const wanted = Math.round(Number(row.quantity) * 1000);
  const short = Number.isFinite(wanted) && wanted > row.stock.milli + held;
  return (
    <p className={`mt-1 text-[12px] ${short ? 'text-danger' : 'text-ink-3'}`}>
      From products · {formatStock(row.stock.milli, row.stock.unit)} in stock
      {held > 0 ? ` + ${formatStock(held, row.stock.unit)} already on this order` : ''}
      {short ? ' — not enough for this quantity' : ''}
    </p>
  );
}
