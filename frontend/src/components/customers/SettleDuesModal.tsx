import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { settleApi, SettlePayload } from '../../api/endpoints';
import { formatDate, todayIST } from '../../lib/date';
import { formatINR, isValidMoney, moneyToPaise, paiseToInput } from '../../lib/money';
import { uuid } from '../../lib/uuid';
import type { PaymentMethod, SettlePreview } from '../../types';
import { MethodPicker } from '../orders/Payments';
import Button from '../ui/Button';
import { TextField } from '../ui/Field';
import { Modal } from '../ui/Modal';

/**
 * One payment from a customer that settles their oldest unpaid orders first. The split is shown
 * (from the server) before anything is saved; saving issues one receipt for the whole collection.
 */
export default function SettleDuesModal({
  open,
  customerId,
  customerName,
  duePaise,
  onClose,
  onSaved,
}: {
  open: boolean;
  customerId: number;
  customerName: string;
  duePaise: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const navigate = useNavigate();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [paidOn, setPaidOn] = useState(todayIST());
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [key, setKey] = useState(uuid());
  const [preview, setPreview] = useState<SettlePreview | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastOpen, setLastOpen] = useState(false);

  // Fresh form (and a fresh retry key) every time the dialog opens.
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setAmount(duePaise > 0 ? paiseToInput(duePaise) : '');
      setMethod('cash');
      setPaidOn(todayIST());
      setReference('');
      setNote('');
      setKey(uuid());
      setPreview(null);
      setErrors({});
      setFormError(null);
    }
  }

  const body = (): SettlePayload | null => {
    const v = amount.trim();
    const paise = moneyToPaise(v) ?? 0;
    const e: Record<string, string> = {};
    if (!isValidMoney(v) || paise <= 0) e.amount = 'Enter an amount, e.g. 500 or 99.50';
    else if (paise > duePaise) e.amount = `That’s more than the total due (${formatINR(duePaise)})`;
    if (!paidOn) e.paidOn = 'Choose a date';
    else if (paidOn > todayIST()) e.paidOn = 'The date can’t be in the future';
    setErrors(e);
    if (Object.keys(e).length) return null;
    return { amount: v, method, paidOn, reference: reference.trim() || null, note: note.trim() || null, idempotencyKey: key };
  };

  const run = async (save: boolean) => {
    const b = body();
    if (!b) return;
    setBusy(true);
    setFormError(null);
    try {
      if (!save) {
        setPreview(await settleApi.preview(customerId, b));
      } else {
        const r = await settleApi.save(customerId, b);
        onSaved();
        navigate(`/receipts/${r.receipt.id}`);
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const touch = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPreview(null); // the split shown no longer matches
  };

  return (
    <Modal
      open={open}
      title={`Settle dues · ${customerName}`}
      onClose={busy ? () => undefined : onClose}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {preview ? (
            <Button onClick={() => run(true)} loading={busy}>
              Confirm and record {formatINR(preview.amountPaise)}
            </Button>
          ) : (
            <Button onClick={() => run(false)} loading={busy}>
              Show split
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-[13.5px] text-ink-2">
          Total due <span className="text-ink">{formatINR(duePaise)}</span>. The payment goes to the oldest unpaid orders first.
        </p>
        {formError && <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-[13.5px] text-danger-strong">{formError}</p>}
        <TextField label="Amount received (₹)" inputMode="decimal" value={amount} onChange={(e) => touch(setAmount)(e.target.value)} error={errors.amount} autoFocus />
        <MethodPicker value={method} onChange={touch(setMethod)} />
        <TextField label="Date" type="date" value={paidOn} max={todayIST()} onChange={(e) => touch(setPaidOn)(e.target.value)} error={errors.paidOn} />
        <TextField label="Reference (optional)" placeholder="UPI / transaction ID, cheque no." value={reference} maxLength={100} onChange={(e) => setReference(e.target.value)} />
        <TextField label="Note (optional)" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
        {preview && (
          <div className="rounded-lg border border-line">
            <table className="w-full text-[13.5px]">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-[0.06em] text-ink-3">
                  <th className="px-3 py-2 font-medium">Order</th>
                  <th className="px-3 py-2 text-right font-medium">Due</th>
                  <th className="px-3 py-2 text-right font-medium">Paying</th>
                  <th className="px-3 py-2 text-right font-medium">Left</th>
                </tr>
              </thead>
              <tbody>
                {preview.allocations.map((a) => (
                  <tr key={a.orderId} className={`border-b border-line last:border-0 ${a.allocatePaise ? '' : 'text-ink-3'}`}>
                    <td className="px-3 py-2">
                      {a.orderNumber} <span className="text-ink-3">· {formatDate(a.orderDate)}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatINR(a.duePaise)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{a.allocatePaise ? formatINR(a.allocatePaise) : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatINR(a.remainingPaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}
