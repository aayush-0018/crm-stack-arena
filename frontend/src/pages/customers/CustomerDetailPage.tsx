import { AtSign, Calendar, MapPin, Pencil, Phone, StickyNote, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { customersApi } from '../../api/endpoints';
import { Stat, StatStrip, TickGauge } from '../../components/charts/StatStrip';
import MessageComposer from '../../components/customers/MessageComposer';
import OrdersTable from '../../components/orders/OrdersTable';
import Avatar from '../../components/ui/Avatar';
import BackButton from '../../components/ui/BackButton';
import Button, { ButtonLink } from '../../components/ui/Button';
import { SectionHeader } from '../../components/ui/Card';
import InfoRows from '../../components/ui/InfoRows';
import { ConfirmDialog } from '../../components/ui/Modal';
import Pagination from '../../components/ui/Pagination';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { PageTop } from '../../components/ui/Tabs';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { formatDateTime, relativeDays } from '../../lib/date';
import { useAsync } from '../../lib/hooks';
import { formatINR, formatINRCompact } from '../../lib/money';

const PAGE_SIZE = 10;

export default function CustomerDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [purge, setPurge] = useState(false);
  const isOwner = useAuth().user?.role === 'owner';

  const customer = useAsync(() => customersApi.get(id), [id]);
  const orders = useAsync(() => customersApi.orders(id, { page, pageSize: PAGE_SIZE }), [id, page]);

  if (customer.loading && !customer.data) return <LoadingState />;
  if (customer.error || !customer.data) {
    const notFound = customer.error instanceof ApiError && customer.error.status === 404;
    return notFound ? (
      <EmptyState title="Customer not found" action={<ButtonLink to="/customers">Back to customers</ButtonLink>} />
    ) : (
      <ErrorState error={customer.error ?? 'Not found'} onRetry={customer.reload} />
    );
  }

  const c = customer.data;
  const lastOrder = orders.data?.data[0]?.orderDate;
  const doDelete = async () => {
    try {
      const r = await customersApi.remove(id, purge);
      toast(
        'success',
        purge ? `${c.name} and their ${c.stats.orderCount} orders deleted` : r.deleted === 'hard' ? `${c.name} deleted` : `${c.name} archived. Order history kept.`,
      );
      navigate('/customers', { replace: true });
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Could not delete customer');
      setConfirmDelete(false);
    }
  };

  return (
    <>
      <PageTop
        leading={<BackButton to="/customers" label="Back to customers" />}
        title={c.name}
        actions={
          <>
            {isOwner && (
              <Button variant="ghost" className="text-[#b42318] hover:text-[#b42318]" onClick={() => setConfirmDelete(true)} aria-label="Delete customer">
                <Trash2 size={15} />
              </Button>
            )}
            <ButtonLink to={`/customers/${c.id}/edit`} variant="secondary">
              <Pencil size={14} /> Edit
            </ButtonLink>
            <ButtonLink to={`/orders/new?customerId=${c.id}`}>New order</ButtonLink>
          </>
        }
      />

      <StatStrip>
        <Stat label="Orders" value={String(c.stats.orderCount)} />
        <Stat label="Total spent" value={formatINRCompact(c.stats.totalSpentPaise)} />
        <Stat
          label="Average order"
          value={formatINR(c.stats.orderCount ? Math.round(c.stats.totalSpentPaise / c.stats.orderCount) : 0).replace(/\.\d+$/, '')}
        />
        <Stat
          label="Outstanding"
          value={formatINRCompact(c.stats.outstandingPaise)}
          suffix={c.stats.totalSpentPaise ? `${Math.round((c.stats.outstandingPaise / c.stats.totalSpentPaise) * 100)}%` : undefined}
          visual={<TickGauge value={c.stats.totalSpentPaise ? c.stats.outstandingPaise / c.stats.totalSpentPaise : 0} label="Share of spend still due" />}
        />
        <Stat label="Last order" value={lastOrder ? relativeDays(lastOrder) : '—'} />
      </StatStrip>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="min-w-0 lg:border-r lg:border-line">
          <SectionHeader title="Order history" />
          {orders.loading && !orders.data ? (
            <LoadingState />
          ) : orders.error ? (
            <ErrorState error={orders.error} onRetry={orders.reload} />
          ) : !orders.data?.data.length ? (
            <EmptyState title="No orders yet" action={<ButtonLink to={`/orders/new?customerId=${c.id}`}>Create order</ButtonLink>} />
          ) : (
            <>
              <OrdersTable orders={orders.data.data} showCustomer={false} dim={orders.loading} />
              <Pagination page={page} pageSize={PAGE_SIZE} total={orders.data.total} onChange={setPage} />
            </>
          )}
        </section>

        <aside className="border-t border-line lg:border-t-0">
          <SectionHeader title="Details" />
          <div className="px-4 py-4 sm:px-6">
            <div className="mb-2 flex items-center gap-3">
              <Avatar name={c.name} size={36} />
              <div>
                <p className="text-[15px] font-medium text-ink">{c.name}</p>
                <p className="text-[12.5px] text-ink-3">Customer since {formatDateTime(c.createdAt).split(',')[0]}</p>
              </div>
            </div>
            <InfoRows
              rows={[
                { icon: <Phone size={15} />, label: 'Phone', value: c.phone },
                { icon: <AtSign size={15} />, label: 'Email', value: c.email || '—' },
                { icon: <MapPin size={15} />, label: 'Address', value: c.address || '—' },
                { icon: <Calendar size={15} />, label: 'Last order', value: relativeDays(lastOrder) },
                { icon: <StickyNote size={15} />, label: 'Notes', value: c.notes || '—' },
              ]}
            />
          </div>
          <SectionHeader title="Message" className="border-t" />
          <div className="px-4 py-4 sm:px-6">
            <MessageComposer name={c.name} phone={c.phone} duePaise={c.stats.outstandingPaise} />
          </div>
        </aside>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete customer?"
        danger
        confirmLabel={purge ? 'Delete everything' : c.stats.orderCount ? 'Archive customer' : 'Delete'}
        onClose={() => {
          setConfirmDelete(false);
          setPurge(false);
        }}
        onConfirm={doDelete}
        message={
          c.stats.orderCount ? (
            <>
              <strong className="text-ink">{c.name}</strong> has {c.stats.orderCount} order{c.stats.orderCount > 1 ? 's' : ''}. By default the customer
              is archived and hidden from lists, and their orders and invoices are kept.
              <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-lg border border-[#f2cdc8] bg-[#fdf3f2] px-3 py-2.5 text-[13.5px] text-[#93291a]">
                <input type="checkbox" checked={purge} onChange={(e) => setPurge(e.target.checked)} className="mt-0.5 h-3.5 w-3.5 accent-[#b42318]" />
                <span>
                  Also delete their {c.stats.orderCount} order{c.stats.orderCount > 1 ? 's' : ''} and all their invoices permanently. This can't be undone.
                </span>
              </label>
            </>
          ) : (
            <>
              <strong className="text-ink">{c.name}</strong> will be permanently deleted. This cannot be undone.
            </>
          )
        }
      />
    </>
  );
}
