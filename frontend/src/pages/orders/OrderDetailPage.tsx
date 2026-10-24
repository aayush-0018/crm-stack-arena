import { AtSign, Calendar, FileText, IndianRupee, MapPin, Pencil, Phone, Send, Tag } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { invoicesApi, ordersApi } from '../../api/endpoints';
import { Stat, StatStrip, TickGauge } from '../../components/charts/StatStrip';
import MessageComposer from '../../components/customers/MessageComposer';
import SendInvoiceModal from '../../components/invoices/SendInvoiceModal';
import Avatar from '../../components/ui/Avatar';
import BackButton from '../../components/ui/BackButton';
import { InvoiceBadge, ORDER_STATUS_LABEL, PaymentBadge, StatusBadge } from '../../components/ui/Badge';
import Button, { ButtonLink } from '../../components/ui/Button';
import { SectionHeader } from '../../components/ui/Card';
import { SelectField, TextField } from '../../components/ui/Field';
import InfoRows from '../../components/ui/InfoRows';
import { ConfirmDialog, Modal } from '../../components/ui/Modal';
import { Alert, EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { PageTop } from '../../components/ui/Tabs';
import { useToast } from '../../context/ToastContext';
import { formatDate, formatDateTime, relativeDays } from '../../lib/date';
import { useAsync } from '../../lib/hooks';
import { formatINR, formatQty, isValidMoney, moneyToPaise, paiseToInput } from '../../lib/money';
import type { Order, OrderStatus } from '../../types';

export default function OrderDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const justCreated = (useLocation().state as { justCreated?: boolean } | null)?.justCreated;
  const order = useAsync(() => ordersApi.get(id), [id]);

  const [invoiceBusy, setInvoiceBusy] = useState(false);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);
  const [reissuePrompt, setReissuePrompt] = useState<{ invoiceNumber: string; nextRevision: number } | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<OrderStatus | null>(null);
  const [composing, setComposing] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);

  if (order.loading && !order.data) return <LoadingState />;
  if (order.error || !order.data) {
    const notFound = order.error instanceof ApiError && order.error.status === 404;
    return notFound ? (
      <EmptyState title="Order not found" action={<ButtonLink to="/orders">Back to orders</ButtonLink>} />
    ) : (
      <ErrorState error={order.error ?? 'Not found'} onRetry={order.reload} />
    );
  }

  const o = order.data;
  const cancelled = o.status === 'cancelled';
  const inv = o.invoice;
  const liveInvoice = inv?.status === 'issued' ? inv : null;
  const due = o.totalPaise - o.amountPaidPaise;

  const generate = async (reissue = false) => {
    setInvoiceBusy(true);
    setInvoiceError(null);
    try {
      const invoice = await invoicesApi.generate(o.id, reissue);
      setReissuePrompt(null);
      navigate(`/invoices/${invoice.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'INVOICE_OUTDATED') {
        setReissuePrompt({ invoiceNumber: String(err.details?.invoiceNumber ?? ''), nextRevision: Number(err.details?.nextRevision ?? 2) });
      } else {
        setInvoiceError(err instanceof Error ? err.message : 'Invoice generation failed');
      }
    } finally {
      setInvoiceBusy(false);
    }
  };

  const changeStatus = async (status: OrderStatus) => {
    try {
      order.setData(await ordersApi.setStatus(o.id, status));
      toast('success', `Order marked ${ORDER_STATUS_LABEL[status].toLowerCase()}`);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Could not update status');
    } finally {
      setPendingStatus(null);
    }
  };

  const invoiceAction = cancelled ? null : liveInvoice && !liveInvoice.outdated ? (
    <>
      <ButtonLink to={`/invoices/${liveInvoice.id}`} variant="secondary">
        <FileText size={15} /> View invoice
      </ButtonLink>
      <Button onClick={() => setSendOpen(true)}>
        <Send size={15} /> Send invoice
      </Button>
    </>
  ) : liveInvoice?.outdated ? (
    <Button onClick={() => generate(true)} loading={invoiceBusy}>
      <FileText size={15} /> Reissue invoice
    </Button>
  ) : (
    <Button onClick={() => generate()} loading={invoiceBusy}>
      <FileText size={15} /> Generate invoice
    </Button>
  );

  return (
    <>
      <PageTop
        leading={<BackButton to="/orders" label="Back to orders" />}
        title={o.orderNumber}
        actions={
          <>
            {!cancelled && (
              <ButtonLink to={`/orders/${o.id}/edit`} variant="secondary">
                <Pencil size={14} /> Edit
              </ButtonLink>
            )}
            {!cancelled && (
              <Button variant="secondary" onClick={() => setPaymentOpen(true)}>
                Record payment
              </Button>
            )}
            {invoiceAction}
          </>
        }
      />

      <StatStrip>
        <Stat label="Order total" value={formatINR(o.totalPaise)} />
        <Stat
          label="Paid"
          value={formatINR(o.amountPaidPaise)}
          suffix={o.totalPaise ? `${Math.round((o.amountPaidPaise / o.totalPaise) * 100)}%` : undefined}
          visual={<TickGauge value={o.totalPaise ? o.amountPaidPaise / o.totalPaise : 0} label="Share of order paid" />}
        />
        <Stat label="Balance due" value={formatINR(due)} visual={<PaymentBadge status={o.paymentStatus} />} />
        <Stat label="Items" value={String(o.items.length)} visual={<StatusBadge status={o.status} />} />
        <Stat label="Order date" value={relativeDays(o.orderDate)} suffix={formatDate(o.orderDate)} />
      </StatStrip>

      {(justCreated && !inv) || invoiceError || liveInvoice?.outdated ? (
        <div className="space-y-2 border-b border-line px-4 py-3 sm:px-6">
          {justCreated && !inv && <Alert tone="success">Order saved. You can now generate the invoice.</Alert>}
          {invoiceError && (
            <Alert tone="error">
              {invoiceError}{' '}
              <button className="font-medium underline" onClick={() => generate()}>
                Retry
              </button>
            </Alert>
          )}
          {liveInvoice?.outdated && (
            <Alert tone="warning">
              This order changed after invoice <strong>{liveInvoice.invoiceNumber}</strong> was issued. The issued invoice still
              shows the old values — reissue to create Rev {liveInvoice.revision + 1}.
            </Alert>
          )}
        </div>
      ) : null}

      <div className="grid lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="min-w-0 lg:border-r lg:border-line">
          <SectionHeader title="Items" />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-[14px]">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-[0.06em] text-ink-3">
                  <th className="h-11 pl-4 pr-3 font-medium sm:pl-6">#</th>
                  <th className="px-3 font-medium">Item</th>
                  <th className="px-3 text-right font-medium">Qty</th>
                  <th className="px-3 text-right font-medium">Unit price</th>
                  <th className="pl-3 pr-4 text-right font-medium sm:pr-6">Amount</th>
                </tr>
              </thead>
              <tbody>
                {o.items.map((it) => (
                  <tr key={it.position}>
                    <td className="h-[46px] pl-4 pr-3 text-ink-3 sm:pl-6">{it.position}</td>
                    <td className="px-3 text-ink">{it.itemName}</td>
                    <td className="px-3 text-right tabular-nums">
                      {formatQty(it.quantity)}
                    </td>
                    <td className="px-3 text-right tabular-nums">{formatINR(it.unitPricePaise)}</td>
                    <td className="pl-3 pr-4 text-right tabular-nums sm:pr-6">{formatINR(it.lineTotalPaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="ml-auto max-w-sm space-y-2 border-t border-line px-4 py-5 text-[14px] sm:px-6">
            <Row label="Subtotal" value={formatINR(o.subtotalPaise)} />
            {o.discountPaise > 0 && <Row label="Discount" value={`− ${formatINR(o.discountPaise)}`} />}
            <Row label="Total" value={formatINR(o.totalPaise)} strong />
            <Row label="Paid" value={formatINR(o.amountPaidPaise)} />
            <Row label="Balance due" value={formatINR(due)} strong />
          </dl>
          {o.notes && (
            <div className="border-t border-line px-4 py-5 sm:px-6">
              <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3">Notes</p>
              <p className="whitespace-pre-line text-[14px] text-ink-2">{o.notes}</p>
            </div>
          )}
        </section>

        <aside className="border-t border-line lg:border-t-0">
          <SectionHeader title="Customer" />
          <div className="px-4 py-4 sm:px-6">
            {o.customer ? (
              <>
                <Link to={`/customers/${o.customer.id}`} className="mb-2 flex items-center gap-3 hover:underline">
                  <Avatar name={o.customer.name} size={32} />
                  <span className="text-[15px] font-medium text-ink">{o.customer.name}</span>
                  {o.customer.deletedAt && <span className="text-[12px] text-ink-3">(archived)</span>}
                </Link>
                <InfoRows
                  rows={[
                    { icon: <Phone size={15} />, label: 'Phone', value: o.customer.phone },
                    { icon: <AtSign size={15} />, label: 'Email', value: o.customer.email || '—' },
                    { icon: <MapPin size={15} />, label: 'Address', value: o.customer.address || '—' },
                  ]}
                />
                <div className="mt-3 flex gap-2">
                  <Button size="sm" onClick={() => setComposing((c) => !c)}>
                    Message
                  </Button>
                  <ButtonLink size="sm" variant="secondary" to={`/customers/${o.customer.id}`}>
                    View profile
                  </ButtonLink>
                </div>
                {composing && (
                  <div className="mt-3">
                    <MessageComposer name={o.customer.name} phone={o.customer.phone} duePaise={cancelled ? 0 : due} autoFocus compact />
                  </div>
                )}
              </>
            ) : (
              <p className="text-[13px] text-ink-3">Unknown customer</p>
            )}
          </div>

          <SectionHeader title="Order" className="border-t" />
          <div className="px-4 py-4 sm:px-6">
            <InfoRows
              rows={[
                { icon: <Tag size={15} />, label: 'Payment', value: <PaymentBadge status={o.paymentStatus} /> },
                { icon: <Calendar size={15} />, label: 'Created', value: formatDateTime(o.createdAt) },
                { icon: <IndianRupee size={15} />, label: 'Due', value: formatINR(due) },
                {
                  icon: <FileText size={15} />,
                  label: 'Invoice',
                  value: inv ? (
                    <span className="flex flex-wrap items-center gap-2">
                      <Link to={`/invoices/${inv.id}`} className="hover:underline">
                        {inv.invoiceNumber}
                        {inv.revision > 1 ? ` · Rev ${inv.revision}` : ''}
                      </Link>
                      <InvoiceBadge status={inv.status} outdated={inv.outdated} />
                    </span>
                  ) : (
                    <span className="text-ink-3">Not generated</span>
                  ),
                },
              ]}
            />
            <SelectField
              label="Order status"
              className="mt-4"
              value={o.status}
              onChange={(e) => {
                const s = e.target.value as OrderStatus;
                if (s === 'cancelled') setPendingStatus(s);
                else changeStatus(s);
              }}
            >
              {Object.entries(ORDER_STATUS_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </SelectField>
            {cancelled && <p className="mt-2 text-[12.5px] text-ink-3">Cancelled orders can’t be invoiced. Reopen to make changes.</p>}
          </div>
        </aside>
      </div>

      <Modal
        open={!!reissuePrompt}
        title="Reissue invoice?"
        onClose={() => setReissuePrompt(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setReissuePrompt(null)}>
              Cancel
            </Button>
            <Button onClick={() => generate(true)} loading={invoiceBusy}>
              Reissue as Rev {reissuePrompt?.nextRevision}
            </Button>
          </>
        }
      >
        The order changed after invoice <strong className="text-ink">{reissuePrompt?.invoiceNumber}</strong> was issued. Reissuing marks the old
        invoice as superseded and creates a new revision with the current values.
      </Modal>

      <ConfirmDialog
        open={pendingStatus === 'cancelled'}
        title="Cancel this order?"
        danger
        confirmLabel="Cancel order"
        onClose={() => setPendingStatus(null)}
        onConfirm={() => changeStatus('cancelled')}
        message={liveInvoice ? `Invoice ${liveInvoice.invoiceNumber} will be marked void.` : 'The order will be marked cancelled. You can reopen it later.'}
      />

      {liveInvoice && (
        <SendInvoiceModal invoiceId={liveInvoice.id} outdated={liveInvoice.outdated} open={sendOpen} onClose={() => setSendOpen(false)} />
      )}

      <PaymentModal
        open={paymentOpen}
        order={o}
        onClose={() => setPaymentOpen(false)}
        onSaved={(updated) => {
          order.setData(updated);
          setPaymentOpen(false);
          toast('success', 'Payment updated');
        }}
      />
    </>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? 'font-medium text-ink' : ''}`}>
      <dt className={strong ? '' : 'text-ink-2'}>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function PaymentModal({ open, order, onClose, onSaved }: { open: boolean; order: Order; onClose: () => void; onSaved: (o: Order) => void }) {
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastOpen, setLastOpen] = useState(false);

  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setAmount(paiseToInput(order.amountPaidPaise));
      setError(null);
    }
  }

  const save = async () => {
    const v = amount.trim() || '0';
    if (!isValidMoney(v)) return setError('Enter a valid amount (up to 2 decimals)');
    if ((moneyToPaise(v) ?? 0) > order.totalPaise) return setError('Amount paid cannot be more than the order total');
    setBusy(true);
    setError(null);
    try {
      onSaved(await ordersApi.setPayment(order.id, v));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save payment');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Record payment"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} loading={busy}>
            Save
          </Button>
        </>
      }
    >
      <p className="mb-3">
        Order total: <span className="text-ink">{formatINR(order.totalPaise)}</span>
      </p>
      <TextField label="Total amount paid so far (₹)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} error={error ?? undefined} autoFocus />
      <div className="mt-2 flex gap-2">
        <Button size="sm" variant="secondary" onClick={() => setAmount(paiseToInput(order.totalPaise))}>
          Fully paid
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setAmount('0')}>
          Unpaid
        </Button>
      </div>
    </Modal>
  );
}
