import { FormEvent, ReactNode, useMemo, useState } from 'react';
import { ApiError } from '../../api/client';
import type { OrderPayload } from '../../api/endpoints';
import { formatINR, lineTotalPaise, moneyToPaise, paiseToInput } from '../../lib/money';
import { zodErrors } from '../../lib/zod';
import { orderSchema } from '../../schemas';
import type { Order, PaymentMethod } from '../../types';
import { CustomerChoice } from '../customers/CustomerPicker';
import Button from '../ui/Button';
import Card from '../ui/Card';
import { TextAreaField, TextField } from '../ui/Field';
import { Alert } from '../ui/States';
import LineItemsEditor, { ItemRow, newRow } from './LineItemsEditor';
import { MethodPicker } from './Payments';

export interface OrderFormState {
  rows: ItemRow[];
  discount: string;
  amountPaid: string;
  notes: string;
  orderDate: string;
}

export const orderToForm = (o: Order): OrderFormState => ({
  rows: o.items.map((it) => ({
    key: `${o.id}-${it.position}`,
    itemName: it.itemName,
    quantity: String(Number(it.quantity)),
    unitPrice: paiseToInput(it.unitPricePaise),
  })),
  discount: o.discountPaise ? paiseToInput(o.discountPaise) : '',
  amountPaid: o.amountPaidPaise ? paiseToInput(o.amountPaidPaise) : '',
  notes: o.notes ?? '',
  orderDate: o.orderDate,
});

export const emptyOrderForm = (today: string): OrderFormState => ({
  rows: [newRow()],
  discount: '',
  amountPaid: '',
  notes: '',
  orderDate: today,
});

/**
 * Shared create/edit form. `customerSection` renders the picker (create) or a read-only card (edit).
 * `validateExtra` lets the caller add customer validation; `submit` receives the order payload.
 */
export default function OrderForm({
  initial,
  customerSection,
  validateExtra,
  submit,
  submitLabel,
  onCancel,
  customerChoice,
  paidSoFarPaise,
}: {
  initial: OrderFormState;
  customerSection: (errors: Record<string, string>) => ReactNode;
  validateExtra?: () => Record<string, string>;
  submit: (payload: OrderPayload) => Promise<void>;
  submitLabel: string;
  onCancel: () => void;
  customerChoice?: CustomerChoice;
  /** Edit mode: what's already been paid. Payments are then changed on the order page, not here. */
  paidSoFarPaise?: number;
}) {
  const editing = paidSoFarPaise !== undefined;
  const [state, setState] = useState(initial);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const totals = useMemo(() => {
    const subtotal = state.rows.reduce((s, r) => s + lineTotalPaise(r.quantity, r.unitPrice), 0);
    const discount = moneyToPaise(state.discount || '0') ?? 0;
    const total = Math.max(0, subtotal - discount);
    const paid = editing ? paidSoFarPaise : (moneyToPaise(state.amountPaid || '0') ?? 0);
    return { subtotal, discount, total, paid, balance: total - paid };
  }, [state, editing, paidSoFarPaise]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);

    // Ignore completely empty trailing rows.
    const rows = state.rows.filter((r, i) => i === 0 || r.itemName.trim() || r.unitPrice.trim());
    if (rows.length !== state.rows.length) setState((s) => ({ ...s, rows })); // keeps error indexes aligned
    const parsed = orderSchema.safeParse({
      items: rows.map(({ itemName, quantity, unitPrice }) => ({ itemName, quantity, unitPrice })),
      discount: state.discount,
      amountPaid: editing ? '' : state.amountPaid,
      notes: state.notes,
    });
    const v: Record<string, string> = { ...(validateExtra?.() ?? {}), ...(parsed.success ? {} : zodErrors(parsed.error)) };
    if (totals.discount > totals.subtotal) v.discount = 'Discount cannot be more than the subtotal';
    if (totals.paid > totals.total) {
      if (editing) v.discount = 'Total is below what’s been paid';
      else v.amountPaid = 'Amount paid cannot be more than the total';
    }
    if (Object.keys(v).length) {
      setErrors(v);
      setFormError(
        editing && totals.paid > totals.total
          ? `The total can’t be less than the ${formatINR(totals.paid)} already paid. Record a refund on the order page first.`
          : 'Please fix the highlighted fields.',
      );
      return;
    }
    setErrors({});

    setSaving(true);
    try {
      await submit({
        items: rows.map((r) => ({
          itemName: r.itemName.trim(),
          quantity: r.quantity.trim(),
          unitPrice: r.unitPrice.trim(),
        })),
        discount: state.discount.trim() || '0',
        ...(editing ? {} : { amountPaid: state.amountPaid.trim() || '0', paymentMethod: method }),
        notes: state.notes.trim() || null,
        orderDate: state.orderDate || undefined,
      });
    } catch (err) {
      if (err instanceof ApiError) {
        const fe = err.fieldErrors;
        // Inline new-customer conflicts come back without the 'newCustomer.' prefix.
        if (err.code === 'PHONE_EXISTS' && customerChoice?.mode === 'new') {
          setErrors({
            'newCustomer.phone': fe.phone ?? err.message,
            'newCustomer.existingCustomerId': String(err.details?.existingCustomerId ?? ''),
          });
        } else setErrors(fe);
        setFormError(err.message);
      } else setFormError('Could not save the order. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      {formError && <Alert tone="error">{formError}</Alert>}

      <Card title="Customer">{customerSection(errors)}</Card>

      <Card title="Items">
        <LineItemsEditor rows={state.rows} onChange={(rows) => setState((s) => ({ ...s, rows }))} errors={errors} />
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Details">
          <div className="space-y-4">
            <TextField
              label="Order date"
              type="date"
              value={state.orderDate}
              onChange={(e) => setState((s) => ({ ...s, orderDate: e.target.value }))}
              error={errors.orderDate}
            />
            <TextAreaField
              label="Notes"
              value={state.notes}
              onChange={(e) => setState((s) => ({ ...s, notes: e.target.value }))}
              error={errors.notes}
            />
          </div>
        </Card>

        <Card title="Review & totals">
          <dl className="space-y-3 text-[14px]">
            <div className="flex justify-between">
              <dt className="text-ink-2">Subtotal</dt>
              <dd className="font-medium tabular-nums">{formatINR(totals.subtotal)}</dd>
            </div>
            <div className="flex items-start justify-between gap-4">
              <dt className="pt-3 text-ink-2">Discount (₹)</dt>
              <dd className="w-36">
                <TextField
                  aria-label="Discount"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={state.discount}
                  onChange={(e) => setState((s) => ({ ...s, discount: e.target.value }))}
                  error={errors.discount}
                />
              </dd>
            </div>
            <div className="flex justify-between border-t border-line pt-3 text-[16px]">
              <dt className="font-medium">Total</dt>
              <dd className="font-medium tabular-nums">{formatINR(totals.total)}</dd>
            </div>
            {editing ? (
              <div className="flex justify-between">
                <dt className="text-ink-2">Paid so far</dt>
                <dd className="font-medium tabular-nums">{formatINR(totals.paid)}</dd>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-4">
                <dt className="pt-3 text-ink-2">
                  Amount paid (₹)
                  <button
                    type="button"
                    className="ml-2 text-[12px] text-ink underline"
                    onClick={() => setState((s) => ({ ...s, amountPaid: paiseToInput(totals.total) }))}
                  >
                    Full
                  </button>
                </dt>
                <dd className="w-36">
                  <TextField
                    aria-label="Amount paid"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={state.amountPaid}
                    onChange={(e) => setState((s) => ({ ...s, amountPaid: e.target.value }))}
                    error={errors.amountPaid}
                  />
                </dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-ink-2">Balance due</dt>
              <dd className="font-medium tabular-nums">{formatINR(Math.max(0, totals.balance))}</dd>
            </div>
          </dl>
          {!editing && totals.paid > 0 && (
            <div className="mt-4">
              <MethodPicker value={method} onChange={setMethod} />
            </div>
          )}
          <p className="mt-3 text-[12px] text-ink-3">
            {editing ? 'Payments and refunds are recorded on the order page. ' : ''}Final amounts are calculated and saved by the server.
          </p>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={saving}>
          {submitLabel}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
