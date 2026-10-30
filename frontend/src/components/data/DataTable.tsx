import { ChevronDown } from 'lucide-react';
import { ReactNode } from 'react';
import Checkbox from '../ui/Checkbox';
import HeaderFilter, { ColumnFilter, isFilterActive } from './HeaderFilter';

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  sortKey?: string;
  align?: 'left' | 'right';
  hideBelow?: 'sm' | 'md' | 'lg';
  /** Can be toggled off from Customize. */
  optional?: boolean;
  /** Filter control shown in this column's header. */
  filter?: ColumnFilter;
  className?: string;
}

const HIDE: Record<NonNullable<Column<unknown>['hideBelow']>, string> = {
  sm: 'hidden sm:table-cell',
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
};

export type SortState = { key: string; dir: 'asc' | 'desc' };

export default function DataTable<T>({
  rows,
  columns,
  rowKey,
  hidden,
  selected,
  onSelectedChange,
  sort,
  onSort,
  onRowClick,
  dim,
  label,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => number | string;
  hidden?: Set<string>;
  selected?: Set<number | string>;
  onSelectedChange?: (next: Set<number | string>) => void;
  sort?: SortState;
  onSort?: (key: string) => void;
  onRowClick?: (row: T) => void;
  dim?: boolean;
  label: string;
}) {
  const cols = columns.filter((c) => !hidden?.has(c.key));
  const selectable = !!selected && !!onSelectedChange;
  const keys = rows.map(rowKey);
  const allOn = selectable && keys.length > 0 && keys.every((k) => selected!.has(k));
  const someOn = selectable && keys.some((k) => selected!.has(k));

  const toggleAll = () => {
    const next = new Set(selected);
    keys.forEach((k) => (allOn ? next.delete(k) : next.add(k)));
    onSelectedChange!(next);
  };
  const toggle = (k: number | string) => {
    const next = new Set(selected);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    onSelectedChange!(next);
  };

  return (
    <div className={`overflow-x-auto transition-opacity ${dim ? 'opacity-50' : ''}`}>
      <table className="w-full border-collapse text-[14px]" aria-label={label}>
        <thead>
          <tr className="border-b border-line">
            {selectable && (
              <th className="w-12 pl-4 sm:pl-6">
                <Checkbox checked={allOn} indeterminate={!allOn && someOn} onChange={toggleAll} label="Select all rows" />
              </th>
            )}
            {cols.map((c, i) => {
              const active = !!sort && !!c.sortKey && sort.key === c.sortKey;
              const filtered = !!c.filter && isFilterActive(c.filter);
              const pad = `${i === 0 && !selectable ? 'pl-4 sm:pl-6' : 'pl-3'} ${i === cols.length - 1 ? 'pr-4 sm:pr-6' : 'pr-3'}`;
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  className={`h-11 whitespace-nowrap text-[11px] font-medium uppercase tracking-[0.06em] ${
                    c.align === 'right' ? 'text-right' : 'text-left'
                  } ${active || filtered ? 'text-ink' : 'text-ink-3'} ${pad} ${c.hideBelow ? HIDE[c.hideBelow] : ''}`}
                >
                  <span className={`inline-flex items-center gap-1 ${c.align === 'right' ? 'flex-row-reverse' : ''}`}>
                  {c.sortKey && onSort ? (
                    <button
                      type="button"
                      onClick={() => onSort(c.sortKey!)}
                      className={`inline-flex items-center gap-1 uppercase hover:text-ink ${c.align === 'right' ? 'flex-row-reverse' : ''}`}
                    >
                      {c.header}
                      <ChevronDown
                        size={13}
                        strokeWidth={2}
                        className={`transition-transform ${active ? '' : 'opacity-0'} ${active && sort!.dir === 'asc' ? 'rotate-180' : ''}`}
                      />
                    </button>
                  ) : (
                    c.header
                  )}
                  {c.filter && <HeaderFilter filter={c.filter} label={c.header} />}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const k = rowKey(row);
            const isSel = selectable && selected!.has(k);
            return (
              <tr
                key={k}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={`group ${onRowClick ? 'cursor-pointer' : ''} ${isSel ? 'bg-wash-2' : 'hover:bg-wash'}`}
              >
                {selectable && (
                  <td className="w-12 pl-4 sm:pl-6">
                    <Checkbox checked={isSel} onChange={() => toggle(k)} label="Select row" />
                  </td>
                )}
                {cols.map((c, i) => (
                  <td
                    key={c.key}
                    className={`h-[46px] whitespace-nowrap ${c.align === 'right' ? 'text-right tabular-nums' : ''} ${
                      i === 0 && !selectable ? 'pl-4 sm:pl-6' : 'pl-3'
                    } ${i === cols.length - 1 ? 'pr-4 sm:pr-6' : 'pr-3'} ${c.hideBelow ? HIDE[c.hideBelow] : ''} ${c.className ?? ''}`}
                  >
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
