import { AtSign, Calendar, FileText, IndianRupee, MapPin, Pencil, Phone, Send, Tag, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { invoicesApi, ordersApi } from '../../api/endpoints';
import { Stat, StatStrip, TickGauge } from '../../components/charts/StatStrip';
import MessageComposer from '../../components/customers/MessageComposer';
import SendInvoiceModal from '../../components/invoices/SendInvoiceModal';
import { MethodPicker, orderDue, PaymentEntryModal, PaymentsSection } from '../../components/orders/Payments';
import { canReturn, ReturnModal, ReturnsSection } from '../../components/orders/Returns';
import Avatar from '../../components/ui/Avatar';
import BackButton from '../../components/ui/BackButton';
import { InvoiceBadge, ORDER_STATUS_LABEL, PaymentBadge, StatusBadge } from '../../components/ui/Badge';
import Button, { ButtonLink } from '../../components/ui/Button';
import { SectionHeader } from '../../components/ui/Card';
import { SelectField } from '../../components/ui/Field';
import InfoRows from '../../components/ui/InfoRows';
import { ConfirmDialog, Modal } from '../../components/ui/Modal';
import { Alert, EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { PageTop } from '../../components/ui/Tabs';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { formatDate, formatDateTime, relativeDays } from '../../lib/date';
import { useAsync } from '../../lib/hooks';
import { formatINR, formatQty } from '../../lib/money';
import type { OrderStatus, PaymentKind, PaymentMethod } from '../../types';

export default function OrderDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const justCreated = (useLocation().state as { justCreated?: boolean } | null)?.justCreated;
  const order = useAsync(() => ordersApi.get(id), [id]);

  const [invoiceBusy, setInvoiceBusy] = useState(false);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);
  const [reissuePrompt, setReissuePrompt] = useState<{ invoiceNumber: string; nextRevision: number } | null>(null);
  const [paymentKind, setPaymentKind] = useState<PaymentKind | null>(null);
  const [refundOnCancel, setRefundOnCancel] = useState(true);
  const [refundMethod, setRefundMethod] = useState<PaymentMethod>('cash');
  const [pendingStatus, setPendingStatus] = useState<OrderStatus | null>(null);
  const [composing, setComposing] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [confirmDeleteOrder, setConfirmDeleteOrder] = useState(false);
  const [returning, setReturning] = useState(false);
  const isOwner = useAuth().user?.role === 'owner';

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
  const due = orderDue(o); // a cancelled order owes nothing, as in every other figure
  // Returned lines refer to the order as sold: it can't be edited, cancelled or deleted any more.
  const hasReturns = o.returns.length > 0;

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

  const changeStatus = async (status: OrderStatus, refund?: { method: PaymentMethod }) => {
    try {
      order.setData(await ordersApi.setStatus(o.id, status, refund));
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
            {isOwner && !hasReturns && (
              <Button variant="ghost" className="text-danger hover:text-danger" onClick={() => setConfirmDeleteOrder(true)} aria-label="Delete order">
                <Trash2 size={15} />
              </Button>
            )}
            {!cancelled && !hasReturns && (
              <ButtonLink to={`/orders/${o.id}/edit`} variant="secondary">
                <Pencil size={14} /> Edit
              </ButtonLink>
            )}
            {canReturn(o) && (
              <Button variant="ghost" onClick={() => setReturning(true)}>
                Return items
              </Button>
            )}
            {o.amountPaidPaise > 0 && (
              <Button variant="ghost" onClick={() => setPaymentKind('refund')}>
                Refund
              </Button>
            )}
            {!cancelled && due > 0 && (
              <Button variant="secondary" onClick={() => setPaymentKind('payment')}>
                Record payment
              </Button>
            )}
            {invoiceAction}
          </>
        }
      />

      <StatStrip page="order">
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
                    <td className="px-3 text-ink">
                      {it.productId ? (
                        <Link to={`/products/${it.productId}`} className="hover:underline">
                          {it.itemName}
                        </Link>
                      ) : (
                        it.itemName
                      )}
                    </td>
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
            {o.returnedPaise > 0 && <Row label="Returned" value={`− ${formatINR(o.returnedPaise)}`} />}
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
          <PaymentsSection
            order={o}
            canRemove={isOwner}
            onChanged={(updated) => {
              order.setData(updated);
              toast('success', 'Entry removed. It stays in the history, crossed out.');
            }}
          />
          <ReturnsSection order={o} />
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
                    <MessageComposer name={o.customer.name} phone={o.customer.phone} duePaise={due} autoFocus compact />
                  </div>
                )}
              </>
            ) : (
              <p className="text-[13px] text-ink-3">{o.customerId ? 'Unknown customer' : o.tableLabel ? `Ordered at table ${o.tableLabel} from its QR code${o.guestName ? ` by ${o.guestName}` : ''}.` : 'Walk-in sale — no customer saved.'}</p>
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
                <option key={v} value={v} disabled={v === 'cancelled' && hasReturns && !cancelled}>
                  {l}
                </option>
              ))}
            </SelectField>
            {cancelled && <p className="mt-2 text-[12.5px] text-ink-3">Cancelled orders can’t be invoiced. Reopen to make changes.</p>}
            {hasReturns && (
              <p className="mt-2 text-[12.5px] text-ink-3">Items were returned, so this order can no longer be edited, cancelled or deleted.</p>
            )}
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
        invoice as replaced and creates a new revision with the current values.
      </Modal>

      <ConfirmDialog
        open={confirmDeleteOrder}
        title={`Delete ${o.orderNumber}?`}
        danger
        confirmLabel="Delete order"
        onClose={() => setConfirmDeleteOrder(false)}
        onConfirm={async () => {
          try {
            const r = await ordersApi.remove(o.id);
            toast('success', `${r.orderNumber} deleted${r.deletedInvoices ? ` with ${r.deletedInvoices} invoice${r.deletedInvoices > 1 ? 's' : ''}` : ''}`);
            navigate('/orders', { replace: true });
          } catch (err) {
            toast('error', err instanceof Error ? err.message : 'Could not delete the order');
            setConfirmDeleteOrder(false);
          }
        }}
        message={
          <>
            The order, its items{inv ? <> and its invoice <strong className="text-ink">{inv.invoiceNumber}</strong> (every revision)</> : null} are deleted
            permanently. Numbers are not reused. This can't be undone.
          </>
        }
      />

      <ConfirmDialog
        open={pendingStatus === 'cancelled'}
        title="Cancel this order?"
        danger
        confirmLabel="Cancel order"
        onClose={() => setPendingStatus(null)}
        onConfirm={() => changeStatus('cancelled', o.amountPaidPaise > 0 && refundOnCancel ? { method: refundMethod } : undefined)}
        message={
          <div className="space-y-3">
            <p>{liveInvoice ? `Invoice ${liveInvoice.invoiceNumber} will be marked cancelled.` : 'The order will be marked cancelled. You can reopen it later.'}</p>
            {o.amountPaidPaise > 0 && (
              <div className="space-y-3 rounded-lg border border-line px-3 py-3">
                <label className="flex cursor-pointer items-start gap-2.5 text-[13.5px] text-ink">
                  <input type="checkbox" checked={refundOnCancel} onChange={(e) => setRefundOnCancel(e.target.checked)} className="mt-0.5 h-3.5 w-3.5 accent-ink" />
                  <span>
                    Refund the {formatINR(o.amountPaidPaise)} paid to the customer
                    <span className="block text-[12.5px] text-ink-3">Untick if you’re keeping the money (for example as credit).</span>
                  </span>
                </label>
                {refundOnCancel && <MethodPicker value={refundMethod} onChange={setRefundMethod} label="Refunded by" />}
              </div>
            )}
          </div>
        }
      />

      {liveInvoice && (
        <SendInvoiceModal invoiceId={liveInvoice.id} outdated={liveInvoice.outdated} open={sendOpen} onClose={() => setSendOpen(false)} />
      )}

      <PaymentEntryModal
        open={!!paymentKind}
        kind={paymentKind ?? 'payment'}
        order={o}
        onClose={() => setPaymentKind(null)}
        onSaved={(updated) => {
          order.setData(updated);
          toast('success', paymentKind === 'refund' ? 'Refund recorded' : 'Payment recorded');
          setPaymentKind(null);
        }}
      />

      <ReturnModal
        open={returning}
        order={o}
        onClose={() => setReturning(false)}
        onSaved={(updated) => {
          order.setData(updated);
          setReturning(false);
          const r = updated.returns[updated.returns.length - 1];
          toast('success', r ? `Return ${r.returnNumber} saved` : 'Return saved');
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
