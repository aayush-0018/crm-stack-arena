import { ChevronLeft, ChevronRight, Download, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ApiError } from '../../api/client';
import { expensesApi, type ExpensePayload } from '../../api/endpoints';
import { Stat, StatStrip, TickGauge } from '../../components/charts/StatStrip';
import DataTable, { Column } from '../../components/data/DataTable';
import { PAYMENT_METHOD_LABEL } from '../../components/orders/Payments';
import Button from '../../components/ui/Button';
import { SectionHeader } from '../../components/ui/Card';
import { SelectField, TextField } from '../../components/ui/Field';
import { ConfirmDialog, Modal } from '../../components/ui/Modal';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { PageTop } from '../../components/ui/Tabs';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { downloadCsv, rupees } from '../../lib/csv';
import { formatDate, todayIST } from '../../lib/date';
import { useAsync } from '../../lib/hooks';
import { formatINR, isValidMoney, paiseToInput } from '../../lib/money';
import type { Expense, ExpenseMethod, ExpenseMonth } from '../../types';

const METHODS: ExpenseMethod[] = ['cash', 'upi', 'card', 'bank', 'other'];

const shiftMonth = (ym: string, n: number) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};
const monthName = (ym: string) => new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${ym}-01T00:00:00Z`));

/** Money the shop spends, month by month, with totals by category and the month's sales beside them. */
export default function ExpensesPage() {
  const toast = useToast();
  const isOwner = useAuth().user?.role === 'owner';
  const [month, setMonth] = useState(todayIST().slice(0, 7));
  const data = useAsync(() => expensesApi.month(month), [month]);
  const [editing, setEditing] = useState<Expense | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Expense | null>(null);
  const thisMonth = todayIST().slice(0, 7);

  const d = data.data;
  const exportCsv = () =>
    d &&
    downloadCsv(`expenses-${d.month}.csv`, d.rows, [
      { header: 'Date', value: (e) => e.spentOn },
      { header: 'Category', value: (e) => e.category },
      { header: 'Amount (Rs)', value: (e) => rupees(e.amountPaise) },
      { header: 'Paid by', value: (e) => PAYMENT_METHOD_LABEL[e.method] },
      { header: 'Note', value: (e) => e.note },
      { header: 'Added by', value: (e) => e.createdByName },
    ]);

  const cols: Column<Expense>[] = [
    { key: 'date', header: 'Date', cell: (e) => formatDate(e.spentOn) },
    {
      key: 'category',
      header: 'Category',
      cell: (e) => (
        <span className="min-w-0">
          <span className="text-ink">{e.category}</span>
          {e.note && <span className="block truncate text-[12.5px] text-ink-3">{e.note}</span>}
        </span>
      ),
    },
    { key: 'method', header: 'Paid by', hideBelow: 'sm', cell: (e) => PAYMENT_METHOD_LABEL[e.method] },
    { key: 'by', header: 'Added by', hideBelow: 'lg', cell: (e) => e.createdByName ?? '—' },
    { key: 'amount', header: 'Amount', align: 'right', cell: (e) => <span className="font-medium text-ink">{formatINR(e.amountPaise)}</span> },
    ...(isOwner
      ? [
          {
            key: 'actions',
            header: '',
            align: 'right' as const,
            cell: (e: Expense) => (
              <span className="inline-flex gap-1">
                <Button size="sm" variant="ghost" aria-label={`Edit ${e.category} expense`} onClick={() => setEditing(e)}>
                  <Pencil size={14} />
                </Button>
                <Button size="sm" variant="ghost" aria-label={`Delete ${e.category} expense`} onClick={() => setDeleting(e)}>
                  <Trash2 size={14} />
                </Button>
              </span>
            ),
          },
        ]
      : []),
  ];
  type Cat = ExpenseMonth['byCategory'][number];
  const catCols: Column<Cat>[] = [
    { key: 'category', header: 'Category', cell: (c) => <span className="text-ink">{c.category}</span> },
    { key: 'count', header: 'Entries', align: 'right', hideBelow: 'sm', cell: (c) => c.count },
    {
      key: 'share',
      header: 'Share',
      hideBelow: 'md',
      cell: (c) => <TickGauge value={d && d.totalPaise ? c.totalPaise / d.totalPaise : 0} label={`${c.category} share of spending`} />,
    },
    { key: 'amount', header: 'Amount', align: 'right', cell: (c) => <span className="font-medium text-ink">{formatINR(c.totalPaise)}</span> },
  ];

  return (
    <>
      <PageTop
        title="Expenses"
        actions={
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus size={14} /> Add expense
          </Button>
        }
      />
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 sm:px-6">
        <Button size="sm" variant="ghost" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>
          <ChevronLeft size={15} />
        </Button>
        <span className="min-w-[130px] text-center text-[14px] text-ink">{monthName(month)}</span>
        <Button size="sm" variant="ghost" aria-label="Next month" disabled={month >= thisMonth} onClick={() => setMonth(shiftMonth(month, 1))}>
          <ChevronRight size={15} />
        </Button>
        <Button size="sm" variant="secondary" className="ml-auto" disabled={!d?.rows.length} onClick={exportCsv}>
          <Download size={14} /> CSV
        </Button>
      </div>

      {!d ? (
        data.error ? <ErrorState error={data.error} onRetry={data.reload} /> : <LoadingState />
      ) : (
        <>
          <StatStrip page="expenses" dim={data.loading}>
            <Stat label="Spent" value={formatINR(d.totalPaise)} suffix={`${d.rows.length} entr${d.rows.length === 1 ? 'y' : 'ies'}`} />
            <Stat label="Sales" value={formatINR(d.salesPaise)} />
            <Stat label="Sales minus expenses" value={formatINR(d.salesPaise - d.totalPaise)} />
            <Stat label="Biggest cost" value={d.byCategory[0]?.category ?? '—'} suffix={d.byCategory[0] ? formatINR(d.byCategory[0].totalPaise) : undefined} />
          </StatStrip>
          {!d.rows.length ? (
            <EmptyState
              title="No expenses this month"
              description="Add rent, salaries, bills and other spending to see where the money goes."
              action={
                <Button size="sm" onClick={() => setEditing('new')}>
                  <Plus size={14} /> Add expense
                </Button>
              }
            />
          ) : (
            <>
              <SectionHeader title="By category" />
              <DataTable label="Expenses by category" rows={d.byCategory} columns={catCols} rowKey={(c) => c.category} dim={data.loading} />
              <SectionHeader title="All expenses" />
              <DataTable label="Expenses" rows={d.rows} columns={cols} rowKey={(e) => e.id} dim={data.loading} />
              <p className="px-4 py-3 text-[12.5px] text-ink-3 sm:px-6">Sales are this month’s orders (not cancelled), by order date. Cost of goods isn’t taken off.</p>
            </>
          )}
        </>
      )}

      <ExpenseModal
        expense={editing === 'new' ? null : editing}
        open={editing !== null}
        categories={d?.categories ?? []}
        defaultDate={month === thisMonth ? todayIST() : `${month}-01`}
        onClose={() => setEditing(null)}
        onSaved={(saved) => {
          setEditing(null);
          toast('success', `${saved.category} · ${formatINR(saved.amountPaise)} saved`);
          if (saved.spentOn.slice(0, 7) !== month) setMonth(saved.spentOn.slice(0, 7));
          else data.reload();
        }}
      />
      <ConfirmDialog
        open={!!deleting}
        title="Delete this expense?"
        message={deleting ? `${deleting.category} · ${formatINR(deleting.amountPaise)} on ${formatDate(deleting.spentOn)}. This can’t be undone.` : ''}
        confirmLabel="Delete"
        danger
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          try {
            await expensesApi.remove(deleting!.id);
            setDeleting(null);
            data.reload();
          } catch (err) {
            toast('error', err instanceof ApiError ? err.message : 'Could not delete. Please try again.');
          }
        }}
      />
    </>
  );
}

function ExpenseModal({
  open,
  expense,
  categories,
  defaultDate,
  onClose,
  onSaved,
}: {
  open: boolean;
  expense: Expense | null;
  categories: string[];
  defaultDate: string;
  onClose: () => void;
  onSaved: (e: Expense) => void;
}) {
  const toast = useToast();
  const blank = (): ExpensePayload => ({ spentOn: defaultDate, category: '', amount: '', method: 'cash', note: '' });
  const [form, setForm] = useState<ExpensePayload>(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setErrors({});
      setForm(
        expense
          ? { spentOn: expense.spentOn, category: expense.category, amount: paiseToInput(expense.amountPaise), method: expense.method, note: expense.note ?? '' }
          : blank(),
      );
    }
  }
  const set = (k: keyof ExpensePayload) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    const err: Record<string, string> = {};
    if (!form.amount.trim() || !isValidMoney(form.amount.trim()) || Number(form.amount) <= 0) err.amount = 'Enter the amount, e.g. 500';
    if (!form.category.trim()) err.category = 'Choose or type a category';
    if (!form.spentOn) err.spentOn = 'Choose the date';
    setErrors(err);
    if (Object.keys(err).length) return;
    setBusy(true);
    const body = { ...form, amount: form.amount.trim(), category: form.category.trim(), note: form.note?.trim() || null };
    try {
      onSaved(expense ? await expensesApi.update(expense.id, body) : await expensesApi.create(body));
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fieldErrors).length) setErrors(e.fieldErrors);
      else toast('error', e instanceof ApiError ? e.message : 'Could not save. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={expense ? 'Edit expense' : 'Add expense'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} loading={busy}>
            {expense ? 'Save' : 'Add'}
          </Button>
        </>
      }
    >
      <form
        className="space-y-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="grid gap-3.5 sm:grid-cols-2">
          <TextField label="Amount (₹)" required inputMode="decimal" value={form.amount} onChange={set('amount')} error={errors.amount} autoFocus />
          <TextField label="Date" required type="date" value={form.spentOn} max={todayIST()} onChange={set('spentOn')} error={errors.spentOn} />
        </div>
        <div>
          <TextField label="Category" required value={form.category} maxLength={40} list="expense-categories" onChange={set('category')} error={errors.category} />
          <datalist id="expense-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {categories.slice(0, 8).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setForm((f) => ({ ...f, category: c }))}
                className={`h-7 rounded-full border px-2.5 text-[12.5px] ${form.category === c ? 'border-ink bg-ink text-on-ink' : 'border-line text-ink-2 hover:bg-hover'}`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
        <SelectField label="Paid by" value={form.method} onChange={(e) => setForm((f) => ({ ...f, method: e.target.value as ExpenseMethod }))}>
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {PAYMENT_METHOD_LABEL[m]}
            </option>
          ))}
        </SelectField>
        <TextField label="Note" value={form.note ?? ''} maxLength={200} onChange={set('note')} error={errors.note} hint="Optional, e.g. who was paid or what for" />
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
