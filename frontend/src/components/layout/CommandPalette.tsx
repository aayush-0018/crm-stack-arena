import { ArrowLeftRight, ChartLine, Contact, FileText, LayoutGrid, Plus, Search, Settings, UserPlus } from 'lucide-react';
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { customersApi, ordersApi } from '../../api/endpoints';
import { useDebounced } from '../../lib/hooks';
import { formatINR } from '../../lib/money';
import Avatar from '../ui/Avatar';

interface Item {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  run: () => void;
}

/** "/" opens it from anywhere (outside text fields). Actions + live customer/order search. */
export default function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const debounced = useDebounced(q.trim(), 200);
  const [results, setResults] = useState<Item[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const go = (path: string) => () => {
    navigate(path);
    onClose();
  };

  const actions: Item[] = useMemo(
    () => [
      { id: 'a-order', group: 'Actions', label: 'New order', icon: <Plus size={16} />, run: go('/orders/new') },
      { id: 'a-cust', group: 'Actions', label: 'Add customer', icon: <UserPlus size={16} />, run: go('/customers/new') },
      { id: 'n-dash', group: 'Go to', label: 'Dashboard', icon: <LayoutGrid size={16} />, run: go('/') },
      { id: 'n-cust', group: 'Go to', label: 'Customers', icon: <Contact size={16} />, run: go('/customers') },
      { id: 'n-ord', group: 'Go to', label: 'Orders', icon: <ArrowLeftRight size={16} />, run: go('/orders') },
      { id: 'n-inv', group: 'Go to', label: 'Invoices', icon: <FileText size={16} />, run: go('/invoices') },
      { id: 'n-ana', group: 'Go to', label: 'Analytics and reports', icon: <ChartLine size={16} />, run: go('/analytics') },
      { id: 'n-set', group: 'Go to', label: 'Settings', icon: <Settings size={16} />, run: go('/settings') },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    if (!open) return;
    setQ('');
    setActive(0);
    setTimeout(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open || debounced.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    Promise.all([customersApi.list({ search: debounced, pageSize: 5 }), ordersApi.list({ search: debounced, pageSize: 5 })])
      .then(([c, o]) => {
        if (cancelled) return;
        setResults([
          ...c.data.map((x) => ({
            id: `c-${x.id}`,
            group: 'Customers',
            label: x.name,
            hint: x.phone,
            icon: <Avatar name={x.name} size={20} />,
            run: go(`/customers/${x.id}`),
          })),
          ...o.data.map((x) => ({
            id: `o-${x.id}`,
            group: 'Orders',
            label: `${x.orderNumber} · ${x.customerName}`,
            hint: formatINR(x.totalPaise),
            icon: <ArrowLeftRight size={16} />,
            run: go(`/orders/${x.id}`),
          })),
        ]);
      })
      .catch(() => !cancelled && setResults([]));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, open]);

  const needle = q.trim().toLowerCase();
  const items = [...actions.filter((a) => !needle || a.label.toLowerCase().includes(needle)), ...results];

  useEffect(() => setActive(0), [q, results.length]);

  if (!open) return null;

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(items.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      items[active]?.run();
    } else if (e.key === 'Escape') onClose();
  };

  let lastGroup = '';
  return (
    <div className="no-print fixed inset-0 z-50 flex items-start justify-center bg-ink/20 px-4 pt-[12vh]" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Quick actions"
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-line bg-white shadow-pop"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKey}
      >
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <Search size={16} className="text-ink-3" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search customers, orders, or type a command"
            className="h-12 flex-1 bg-transparent text-[15px] placeholder:text-ink-3 focus:outline-none"
          />
          <kbd className="rounded border border-line px-1.5 text-[11px] text-ink-3">Esc</kbd>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto p-1.5" role="listbox">
          {items.length === 0 && <li className="px-3 py-6 text-center text-[13px] text-ink-3">No matches</li>}
          {items.map((it, i) => {
            const header = it.group !== lastGroup ? it.group : null;
            lastGroup = it.group;
            return (
              <li key={it.id}>
                {header && <p className="px-2.5 pb-1 pt-2.5 text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3">{header}</p>}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={it.run}
                  className={`flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[14px] ${i === active ? 'bg-hover' : ''}`}
                >
                  <span className="flex w-5 justify-center text-ink-2">{it.icon}</span>
                  <span className="flex-1 truncate text-ink">{it.label}</span>
                  {it.hint && <span className="text-[12.5px] text-ink-3">{it.hint}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
