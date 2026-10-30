import { FileText } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ReturnPayload, returnsApi } from '../../api/endpoints';
import { formatDate } from '../../lib/date';
import { formatINR, formatQty } from '../../lib/money';
import { uuid } from '../../lib/uuid';
import type { Order, PaymentMethod, ReturnCondition, ReturnPreview } from '../../types';
import Button from '../ui/Button';
import { SectionHeader } from '../ui/Card';
import { SelectField, TextField } from '../ui/Field';
import { Modal } from '../ui/Modal';
import { PAYMENT_METHOD_LABEL, PAYMENT_METHODS } from './Payments';

/** Quantity of each order line already returned, in milli-units. */
export function returnedByPosition(order: Order) {
  const map = new Map<number, number>();
  for (const r of order.returns) for (const it of r.items) map.set(it.position, (map.get(it.position) ?? 0) + Math.round(Number(it.quantity) * 1000));
  return map;
}

/** True while some item on the order can still be returned. */
export const canReturn = (order: Order) => {
  if (order.status === 'cancelled') return false;
  const done = returnedByPosition(order);
  return order.items.some((it) => Math.round(Number(it.quantity) * 1000) > (done.get(it.position) ?? 0));
};

interface LineState {
  position: number;
  quantity: string;
  condition: ReturnCondition;
}

/**
 * Return items from an order: pick quantities and their condition, check the server's preview
 * (value, refund, new balance), then save. Nothing is saved until "Save return".
 */
export function ReturnModal({ open, order, onClose, onSaved }: { open: boolean; order: Order; onClose: () => void; onSaved: (o: Order, returnId: number) => void }) {
  const [lines, setLines] = useState<LineState[]>([]);
  const [reason, setReason] = useState('');
  const [refundMethod, setRefundMethod] = useState<'original' | PaymentMethod>('original');
  const [key, setKey] = useState(uuid());
  const [preview, setPreview] = useState<ReturnPreview | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastOpen, setLastOpen] = useState(false);
  const done = returnedByPosition(order);
  const left = (position: number, sold: string) => Math.round(Number(sold) * 1000) - (done.get(position) ?? 0);

  // Fresh form (and a fresh retry key) every time the dialog opens.
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setLines(order.items.map((it) => ({ position: it.position, quantity: '', condition: 'saleable' })));
      setReason('');
      setRefundMethod('original');
      setKey(uuid());
      setPreview(null);
      setErrors({});
      setFormError(null);
    }
  }

  const payload = (): ReturnPayload | null => {
    const e: Record<string, string> = {};
    const items: ReturnPayload['items'] = [];
    lines.forEach((l, i) => {
      const q = l.quantity.trim();
      if (!q) return;
      const milli = Math.round(Number(q) * 1000);
      const item = order.items.find((it) => it.position === l.position)!;
      if (!/^\d{1,5}(\.\d{1,3})?$/.test(q) || milli <= 0) e[`line.${i}`] = 'Enter a quantity, e.g. 1 or 0.5';
      else if (milli > left(l.position, item.quantity)) e[`line.${i}`] = `Only ${left(l.position, item.quantity) / 1000} left to return`;
      else items.push({ position: l.position, quantity: q, condition: l.condition });
    });
    if (!items.length && !Object.keys(e).length) e.form = 'Enter how many of an item are coming back';
    setErrors(e);
    if (Object.keys(e).length) return null;
    return { items, reason: reason.trim() || null, refundMethod, idempotencyKey: key };
  };

  const check = async () => {
    const body = payload();
    if (!body) return;
    setBusy(true);
    setFormError(null);
    try {
      setPreview((await returnsApi.preview(order.id, body)).preview);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not check the return');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const body = payload();
    if (!body) return;
    setBusy(true);
    setFormError(null);
    try {
      const r = await returnsApi.save(order.id, body);
      onSaved(r.order, r.return.id);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save the return');
    } finally {
      setBusy(false);
    }
  };

  const edit = (i: number, patch: Partial<LineState>) => {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
    setPreview(null); // the preview no longer matches
  };

  return (
    <Modal
      open={open}
      title={`Return items · ${order.orderNumber}`}
      onClose={busy ? () => undefined : onClose}
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {preview ? (
            <Button onClick={save} loading={busy}>
              Save return
            </Button>
          ) : (
            <Button onClick={check} loading={busy}>
              Check return
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {formError && <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-[13.5px] text-danger-strong">{formError}</p>}
        {errors.form && <p className="text-[13px] text-danger">{errors.form}</p>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-[14px]">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-[0.06em] text-ink-3">
                <th className="pb-2 pr-3 font-medium">Item</th>
                <th className="pb-2 pr-3 text-right font-medium">Sold</th>
                <th className="pb-2 pr-3 text-right font-medium">Left</th>
                <th className="pb-2 pr-3 font-medium">Returning</th>
                <th className="pb-2 font-medium">Condition</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((it, i) => {
                const remaining = left(it.position, it.quantity);
                const l = lines[i];
                if (!l) return null;
                return (
                  <tr key={it.position} className="border-b border-line align-top">
                    <td className="py-2.5 pr-3 text-ink">{it.itemName}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-ink-2">{formatQty(it.quantity)}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-ink-2">{remaining / 1000}</td>
                    <td className="py-1.5 pr-3">
                      <input
                        aria-label={`Quantity of ${it.itemName} returned`}
                        inputMode="decimal"
                        disabled={remaining <= 0}
                        placeholder={remaining > 0 ? '0' : 'All returned'}
                        value={l.quantity}
                        onChange={(e) => edit(i, { quantity: e.target.value })}
                        className={`h-9 w-28 rounded-lg border bg-surface px-3 text-[14px] text-ink placeholder:text-ink-4 shadow-soft focus:outline-none focus:ring-[3px] disabled:opacity-50 ${
                          errors[`line.${i}`] ? 'border-danger-line-2 focus:ring-danger/10' : 'border-line focus:border-ink-4 focus:ring-ink/5'
                        }`}
                      />
                      {errors[`line.${i}`] && <p className="mt-1 text-[12px] text-danger">{errors[`line.${i}`]}</p>}
                    </td>
                    <td className="py-1.5">
                      <select
                        aria-label={`Condition of ${it.itemName}`}
                        disabled={remaining <= 0}
                        value={l.condition}
                        onChange={(e) => edit(i, { condition: e.target.value as ReturnCondition })}
                        className="h-9 rounded-lg border border-line bg-surface px-2 text-[14px] text-ink shadow-soft focus:border-ink-4 focus:outline-none focus:ring-[3px] focus:ring-ink/5 disabled:opacity-50"
                      >
                        <option value="saleable">Saleable · back in stock</option>
                        <option value="damaged">Damaged · not resold</option>
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Refund any excess to"
            value={refundMethod}
            onChange={(e) => {
              setRefundMethod(e.target.value as 'original' | PaymentMethod);
              setPreview(null);
            }}
          >
            <option value="original">How the customer paid (newest payment first)</option>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABEL[m]}
              </option>
            ))}
          </SelectField>
          <TextField label="Reason (optional)" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
        </div>
        {preview && (
          <div className="rounded-lg border border-line px-4 py-3 text-[13.5px]">
            <dl className="grid grid-cols-[1fr_auto] gap-y-1">
              <dt className="text-ink-2">Value of returned items</dt>
              <dd className="text-right tabular-nums text-ink">{formatINR(preview.valuePaise)}</dd>
              <dt className="text-ink-2">Order total</dt>
              <dd className="text-right tabular-nums text-ink">
                {formatINR(preview.totalBeforePaise)} → {formatINR(preview.totalAfterPaise)}
              </dd>
              <dt className="text-ink-2">Refund now</dt>
              <dd className="text-right tabular-nums text-ink">{formatINR(preview.refundPaise)}</dd>
              {preview.refunds.map((r) => (
                <dd key={r.method} className="col-span-2 text-right text-[12.5px] text-ink-3">
                  {PAYMENT_METHOD_LABEL[r.method]} {formatINR(r.amountPaise)}
                </dd>
              ))}
              <dt className="text-ink-2">Still due after the return</dt>
              <dd className="text-right tabular-nums text-ink">{formatINR(preview.dueAfterPaise)}</dd>
            </dl>
            <p className="mt-2 text-[12.5px] text-ink-3">
              The return first reduces what is owed; only money paid beyond the new total is refunded. The invoice stays as issued.
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}

/** The order's returns, each linking to its return adjustment document. */
export function ReturnsSection({ order }: { order: Order }) {
  if (!order.returns.length) return null;
  return (
    <section aria-label="Returns" className="border-t border-line">
      <SectionHeader title="Returns" className="border-b-0" />
      <ul className="px-4 pb-3 sm:px-6">
        {order.returns.map((r) => (
          <li key={r.id} className="flex items-start gap-3 border-t border-line py-3 first:border-t-0">
            <div className="min-w-0 flex-1">
              <Link to={`/returns/${r.id}`} className="inline-flex items-center gap-1.5 text-[14px] text-ink hover:underline">
                <FileText size={14} /> {r.returnNumber}
              </Link>
              <p className="text-[12.5px] text-ink-3">
                {formatDate(r.returnDate)} ·{' '}
                {r.items.map((it) => `${formatQty(it.quantity)} × ${it.itemName}${it.condition === 'damaged' ? ' (damaged)' : ''}`).join(', ')}
                {r.reason ? ` · ${r.reason}` : ''}
              </p>
              {r.refundPaise > 0 && (
                <p className="text-[12.5px] text-ink-3">
                  Refunded {formatINR(r.refundPaise)}
                  {r.refunds.some((p) => p.receiptNumber) ? ` · ${r.refunds.map((p) => p.receiptNumber).filter(Boolean).join(', ')}` : ''}
                </p>
              )}
            </div>
            <span className="pt-0.5 text-[14px] tabular-nums text-ink">− {formatINR(r.valuePaise)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
