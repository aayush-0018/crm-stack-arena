import { Receipt as ReceiptIcon, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ordersApi } from '../../api/endpoints';
import { formatDate, formatDateTime, todayIST } from '../../lib/date';
import { formatINR, isValidMoney, moneyToPaise, paiseToInput } from '../../lib/money';
import { uuid } from '../../lib/uuid';
import type { Order, Payment, PaymentKind, PaymentMethod } from '../../types';
import Button from '../ui/Button';
import { SectionHeader } from '../ui/Card';
import { TextField } from '../ui/Field';
import { ConfirmDialog, Modal } from '../ui/Modal';

export const PAYMENT_METHOD_LABEL: Record<Payment['method'], string> = {
  cash: 'Cash',
  upi: 'UPI',
  card: 'Card',
  bank: 'Bank transfer',
  other: 'Other',
  unrecorded: 'Method not recorded',
};
export const PAYMENT_METHODS: PaymentMethod[] = ['cash', 'upi', 'card', 'bank', 'other'];

/** What the customer still owes. A cancelled order owes nothing. */
export const orderDue = (o: Order) => (o.status === 'cancelled' ? 0 : o.totalPaise - o.amountPaidPaise);

/** Cash / UPI / Card … as one row of toggle buttons. */
export function MethodPicker({ value, onChange, label = 'Paid by' }: { value: PaymentMethod; onChange: (m: PaymentMethod) => void; label?: string }) {
  const id = useId();
  return (
    <div>
      <p id={id} className="mb-1.5 text-[13px] font-medium text-ink">
        {label}
      </p>
      <div role="radiogroup" aria-labelledby={id} className="flex flex-wrap gap-1.5">
        {PAYMENT_METHODS.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={value === m}
            onClick={() => onChange(m)}
            className={`h-8 rounded-md border px-3 text-[13px] ${value === m ? 'border-ink bg-ink text-on-ink' : 'border-line text-ink-2 hover:bg-hover'}`}
          >
            {PAYMENT_METHOD_LABEL[m]}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Record one payment, or one refund, against an order. */
export function PaymentEntryModal({
  open,
  kind,
  order,
  onClose,
  onSaved,
}: {
  open: boolean;
  kind: PaymentKind;
  order: Order;
  onClose: () => void;
  onSaved: (o: Order) => void;
}) {
  const limit = kind === 'payment' ? orderDue(order) : order.amountPaidPaise;
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [paidOn, setPaidOn] = useState(todayIST());
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [key, setKey] = useState(uuid());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastOpen, setLastOpen] = useState(false);

  // Fresh form (and a fresh retry key) every time the dialog opens.
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setAmount(limit > 0 ? paiseToInput(limit) : '');
      setMethod('cash');
      setPaidOn(todayIST());
      setReference('');
      setNote('');
      setKey(uuid());
      setErrors({});
      setFormError(null);
    }
  }

  const save = async () => {
    const v = amount.trim();
    const e: Record<string, string> = {};
    const paise = moneyToPaise(v) ?? 0;
    if (!isValidMoney(v) || paise <= 0) e.amount = 'Enter an amount, e.g. 250 or 99.50';
    else if (paise > limit) e.amount = kind === 'payment' ? `That’s more than the balance due (${formatINR(limit)})` : `You can refund at most ${formatINR(limit)}`;
    if (!paidOn) e.paidOn = 'Choose a date';
    else if (paidOn > todayIST()) e.paidOn = 'The date can’t be in the future';
    setErrors(e);
    if (Object.keys(e).length) return;

    setBusy(true);
    setFormError(null);
    try {
      onSaved(
        await ordersApi.addPayment(order.id, {
          kind,
          amount: v,
          method,
          paidOn,
          reference: reference.trim() || null,
          note: note.trim() || null,
          idempotencyKey: key,
        }),
      );
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const refund = kind === 'refund';
  return (
    <Modal
      open={open}
      title={refund ? 'Record refund' : 'Record payment'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} loading={busy}>
            {refund ? 'Save refund' : 'Save payment'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-[13.5px] text-ink-2">
          Order total <span className="text-ink">{formatINR(order.totalPaise)}</span> · paid{' '}
          <span className="text-ink">{formatINR(order.amountPaidPaise)}</span> · due{' '}
          <span className="text-ink">{formatINR(orderDue(order))}</span>
        </p>
        {formError && <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-[13.5px] text-danger-strong">{formError}</p>}
        <TextField
          label={refund ? 'Amount refunded (₹)' : 'Amount received (₹)'}
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          error={errors.amount}
          hint={refund ? `Up to ${formatINR(limit)}` : `Balance due ${formatINR(limit)}`}
          autoFocus
        />
        <MethodPicker value={method} onChange={setMethod} label={refund ? 'Refunded by' : 'Paid by'} />
        <TextField label="Date" type="date" value={paidOn} max={todayIST()} onChange={(e) => setPaidOn(e.target.value)} error={errors.paidOn} />
        <TextField label="Reference (optional)" placeholder="UPI / transaction ID, cheque no." value={reference} maxLength={100} onChange={(e) => setReference(e.target.value)} />
        <TextField label="Note (optional)" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
      </div>
    </Modal>
  );
}

/** The order's payment history, with removal of mistaken entries (owners only). */
export function PaymentsSection({ order, canRemove, onChanged }: { order: Order; canRemove: boolean; onChanged: (o: Order) => void }) {
  const navigate = useNavigate();
  const [removing, setRemoving] = useState<Payment | null>(null);
  const [issuing, setIssuing] = useState<number | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  // Entries recorded before receipts existed get one on request (always the same one afterwards).
  const openReceipt = async (p: Payment) => {
    setIssuing(p.id);
    setReceiptError(null);
    try {
      navigate(`/receipts/${(await ordersApi.receiptFor(order.id, p.id)).receiptId}`);
    } catch (err) {
      setReceiptError(err instanceof Error ? err.message : 'Could not get the receipt');
    } finally {
      setIssuing(null);
    }
  };
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const live = order.payments.filter((p) => !p.voidedAt);
  const paid = live.filter((p) => p.kind === 'payment').reduce((t, p) => t + p.amountPaise, 0);
  const refunded = live.filter((p) => p.kind === 'refund').reduce((t, p) => t + p.amountPaise, 0);

  return (
    <section aria-label="Payments" className="border-t border-line">
      <SectionHeader title="Payments" className="border-b-0" />
      {order.payments.length === 0 ? (
        <p className="px-4 pb-5 text-[13.5px] text-ink-3 sm:px-6">No payments recorded yet.</p>
      ) : (
        <ul className="px-4 pb-2 sm:px-6">
          {order.payments.map((p) => {
            const voided = !!p.voidedAt;
            const refund = p.kind === 'refund';
            return (
              <li key={p.id} className="flex items-start gap-3 border-t border-line py-3 first:border-t-0">
                <div className={`min-w-0 flex-1 ${voided ? 'text-ink-3' : ''}`}>
                  <p className={`text-[14px] ${voided ? 'line-through' : 'text-ink'}`}>
                    {refund ? 'Refund' : 'Payment'} · {PAYMENT_METHOD_LABEL[p.method]}
                    {p.reference ? <span className="text-ink-2"> · {p.reference}</span> : null}
                  </p>
                  <p className="text-[12.5px] text-ink-3">
                    {formatDate(p.paidOn)}
                    {p.createdByName ? ` · recorded by ${p.createdByName}` : ''}
                    {p.note ? ` · ${p.note}` : ''}
                  </p>
                  {voided && (
                    <p className="text-[12.5px] text-ink-3">
                      Removed {formatDateTime(p.voidedAt!)}
                      {p.voidReason ? ` — ${p.voidReason}` : ''}
                    </p>
                  )}
                  {p.receiptId ? (
                    <Link to={`/receipts/${p.receiptId}`} className="mt-0.5 inline-flex items-center gap-1 text-[12.5px] text-ink-2 hover:text-ink hover:underline">
                      <ReceiptIcon size={12} /> {p.receiptNumber}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => openReceipt(p)}
                      disabled={issuing === p.id}
                      className="mt-0.5 inline-flex items-center gap-1 text-[12.5px] text-ink-3 underline-offset-2 hover:text-ink hover:underline disabled:opacity-50"
                    >
                      <ReceiptIcon size={12} /> {issuing === p.id ? 'Getting receipt…' : 'Get receipt'}
                    </button>
                  )}
                </div>
                <span className={`pt-0.5 text-[14px] tabular-nums ${voided ? 'text-ink-3 line-through' : refund ? 'text-danger' : 'text-ink'}`}>
                  {refund ? '− ' : ''}
                  {formatINR(p.amountPaise)}
                </span>
                {canRemove && !voided && (
                  <button
                    type="button"
                    onClick={() => {
                      setRemoving(p);
                      setReason('');
                      setError(null);
                    }}
                    aria-label={`Remove ${refund ? 'refund' : 'payment'} of ${formatINR(p.amountPaise)} on ${formatDate(p.paidOn)}`}
                    className="rounded-md p-1 text-ink-3 hover:bg-hover hover:text-danger"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {receiptError && (
        <p role="alert" className="px-4 pb-2 text-[13px] text-danger sm:px-6">
          {receiptError}
        </p>
      )}
      {live.length > 0 && (
        <dl className="flex flex-wrap justify-end gap-x-5 gap-y-1 border-t border-line px-4 py-3 text-[13px] text-ink-2 sm:px-6">
          <div className="flex gap-1.5">
            <dt>Received</dt>
            <dd className="tabular-nums text-ink">{formatINR(paid)}</dd>
          </div>
          {refunded > 0 && (
            <div className="flex gap-1.5">
              <dt>Refunded</dt>
              <dd className="tabular-nums text-ink">{formatINR(refunded)}</dd>
            </div>
          )}
          <div className="flex gap-1.5">
            <dt>Balance due</dt>
            <dd className="tabular-nums text-ink">{formatINR(orderDue(order))}</dd>
          </div>
        </dl>
      )}

      <ConfirmDialog
        open={!!removing}
        title={`Remove this ${removing?.kind === 'refund' ? 'refund' : 'payment'}?`}
        danger
        confirmLabel="Remove"
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return;
          try {
            onChanged(await ordersApi.voidPayment(order.id, removing.id, reason.trim() || null));
            setRemoving(null);
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not remove it');
          }
        }}
        message={
          <div className="space-y-3">
            <p>
              Use this for an entry made by mistake. It stays in the history, crossed out, and stops counting towards the amount paid.
            </p>
            {error && <p role="alert" className="text-danger-strong">{error}</p>}
            <TextField label="Reason (optional)" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
          </div>
        }
      />
    </section>
  );
}
