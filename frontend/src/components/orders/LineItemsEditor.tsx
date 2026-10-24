import { KeyboardEvent } from 'react';
import { formatINR, lineTotalPaise } from '../../lib/money';
import { uuid } from '../../lib/uuid';
import Button from '../ui/Button';

export interface ItemRow {
  key: string;
  itemName: string;
  quantity: string;
  unitPrice: string;
}

export const newRow = (): ItemRow => ({ key: uuid(), itemName: '', quantity: '1', unitPrice: '' });

const input = (invalid?: boolean) =>
  `h-9 w-full rounded-lg border bg-white px-3 text-[14px] text-ink placeholder:text-ink-4 shadow-soft focus:outline-none focus:ring-[3px] ${
    invalid ? 'border-[#e5a59e] focus:ring-[#b42318]/10' : 'border-line focus:border-ink-4 focus:ring-ink/5'
  }`;

export default function LineItemsEditor({
  rows,
  onChange,
  errors,
}: {
  rows: ItemRow[];
  onChange: (rows: ItemRow[]) => void;
  errors: Record<string, string>;
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
      {errors.items && <p className="mb-2 text-sm text-[#b42318]">{errors.items}</p>}

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
              <input
                data-item-name
                aria-label={`Item ${i + 1} name`}
                placeholder="Item name"
                className={input(!!err(i, 'itemName'))}
                value={r.itemName}
                onChange={(e) => update(i, { itemName: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
              />
              {err(i, 'itemName') && <p className="mt-1 text-xs text-[#b42318]">{err(i, 'itemName')}</p>}
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
              {err(i, 'quantity') && <p className="mt-1 text-xs text-[#b42318]">{err(i, 'quantity')}</p>}
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
              {err(i, 'unitPrice') && <p className="mt-1 text-xs text-[#b42318]">{err(i, 'unitPrice')}</p>}
            </div>
            <p className="self-center text-right text-sm font-medium tabular-nums md:pt-3">
              {formatINR(lineTotalPaise(r.quantity, r.unitPrice))}
            </p>
            <button
              type="button"
              onClick={() => remove(i)}
              aria-label={`Remove item ${i + 1}`}
              className="justify-self-end rounded-lg p-2 text-ink-4 hover:bg-[#fdf3f2] hover:text-[#b42318]"
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
