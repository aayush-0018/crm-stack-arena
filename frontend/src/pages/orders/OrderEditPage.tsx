import { Link, useNavigate, useParams } from 'react-router-dom';
import { ordersApi } from '../../api/endpoints';
import OrderForm, { orderToForm } from '../../components/orders/OrderForm';
import { ButtonLink } from '../../components/ui/Button';
import BackButton from '../../components/ui/BackButton';
import { PageTop } from '../../components/ui/Tabs';
import { Alert, EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { useToast } from '../../context/ToastContext';
import { useAsync } from '../../lib/hooks';

export default function OrderEditPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const order = useAsync(() => ordersApi.get(id), [id]);

  if (order.loading) return <LoadingState />;
  if (order.error || !order.data) return <ErrorState error={order.error ?? 'Not found'} onRetry={order.reload} />;
  const o = order.data;

  if (o.status === 'cancelled') {
    return (
      <EmptyState
        title="This order is cancelled"
        description="Reopen the order before editing it."
        action={<ButtonLink to={`/orders/${o.id}`}>Back to order</ButtonLink>}
      />
    );
  }

  return (
    <>
      <PageTop leading={<BackButton to={`/orders/${o.id}`} label="Back to order" />} title={`Edit ${o.orderNumber}`} />
      <div className="max-w-5xl px-4 py-6 sm:px-6">
      {o.invoice?.status === 'issued' && (
        <div className="mb-5">
          <Alert tone="warning">
            Invoice {o.invoice.invoiceNumber} was already issued. Saving changes will <strong>not</strong> change that
            invoice. You can reissue it from the order page afterwards.
          </Alert>
        </div>
      )}
      <OrderForm
        initial={orderToForm(o)}
        paidSoFarPaise={o.amountPaidPaise}
        customerSection={() =>
          o.customer ? (
            <div className="text-sm">
              <Link to={`/customers/${o.customer.id}`} className="font-medium text-ink hover:underline">
                {o.customer.name}
              </Link>
              <p className="text-ink-2">{o.customer.phone}</p>
            </div>
          ) : (
            <p className="text-sm text-ink-2">Walk-in sale — no customer saved.</p>
          )
        }
        submitLabel="Save changes"
        onCancel={() => navigate(`/orders/${o.id}`)}
        submit={async (payload) => {
          await ordersApi.update(o.id, payload);
          toast('success', 'Order updated');
          navigate(`/orders/${o.id}`, { replace: true });
        }}
      />
      </div>
    </>
  );
}
