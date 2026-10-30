import { KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { productsApi } from '../../api/endpoints';
import { formatINR } from '../../lib/money';
import type { Product } from '../../types';
import { formatStock } from '../products/ProductParts';

/**
 * The item-name box of an order line. Typing searches the product list; picking a product fills
 * the line. Anything typed by hand still works as a free-text item.
 */
export default function ProductPicker({
  value,
  index,
  invalid,
  className,
  onType,
  onPick,
}: {
  value: string;
  index: number;
  invalid: boolean;
  className: string;
  onType: (text: string) => void;
  onPick: (p: Product) => void;
}) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<Product[]>([]);
  const [active, setActive] = useState(0);
  const [typed, setTyped] = useState(false);
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);

  // Search only after the person types (not when a saved order is opened), debounced.
  useEffect(() => {
    if (!typed) return;
    const q = value.trim();
    if (!q) {
      setOptions([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      productsApi
        .list({ search: q, status: 'active', pageSize: 6 })
        .then((r) => {
          if (cancelled) return;
          setOptions(r.data);
          setActive(0);
          setOpen(r.data.length > 0);
        })
        .catch(() => undefined); // the field still works as free text
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [value, typed]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const pick = (p: Product) => {
    onPick(p);
    setOpen(false);
    setTyped(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.preventDefault();
    if (!open || !options.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (a + 1) % options.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (a - 1 + options.length) % options.length);
    } else if (e.key === 'Enter') {
      pick(options[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={box} className="relative">
      <input
        data-item-name
        role="combobox"
        aria-label={`Item ${index + 1} name`}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        aria-invalid={invalid}
        autoComplete="off"
        placeholder="Item name or search products"
        className={className}
        value={value}
        onChange={(e) => {
          setTyped(true);
          onType(e.target.value);
        }}
        onKeyDown={onKeyDown}
      />
      {open && (
        <ul id={listId} role="listbox" className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-pop">
          {options.map((p, i) => (
            <li
              key={p.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault(); // keep focus in the input
                pick(p);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-[13.5px] ${i === active ? 'bg-hover' : ''}`}
            >
              <span className="min-w-0">
                <span className="block truncate text-ink">{p.name}</span>
                {p.trackStock && (
                  <span className={`block text-[12px] ${p.stockMilli <= 0 ? 'text-danger' : p.low ? 'text-warn-text' : 'text-ink-3'}`}>
                    {p.stockMilli <= 0 ? 'Out of stock' : `${formatStock(p.stockMilli, p.unit)} in stock`}
                  </span>
                )}
              </span>
              <span className="shrink-0 tabular-nums text-ink-2">
                {formatINR(p.pricePaise)}
                <span className="text-ink-3"> / {p.unit}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
