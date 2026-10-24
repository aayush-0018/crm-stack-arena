import { useNavigate, useParams } from 'react-router-dom';
import { customersApi } from '../../api/endpoints';
import CustomerForm, { customerToForm } from '../../components/customers/CustomerForm';
import BackButton from '../../components/ui/BackButton';
import Card from '../../components/ui/Card';
import { PageTop } from '../../components/ui/Tabs';
import { ErrorState, LoadingState } from '../../components/ui/States';
import { useToast } from '../../context/ToastContext';
import { useAsync } from '../../lib/hooks';

export default function CustomerEditPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const customer = useAsync(() => customersApi.get(id), [id]);

  if (customer.loading) return <LoadingState />;
  if (customer.error || !customer.data) return <ErrorState error={customer.error ?? 'Not found'} onRetry={customer.reload} />;

  return (
    <>
      <PageTop leading={<BackButton to={`/customers/${id}`} label="Back to customer" />} title={`Edit ${customer.data.name}`} />
      <div className="max-w-3xl px-4 py-6 sm:px-6">
      <Card title="Customer details">
        <CustomerForm
          initial={customerToForm(customer.data)}
          submitLabel="Save changes"
          onCancel={() => navigate(`/customers/${id}`)}
          onSubmit={async (payload) => {
            await customersApi.update(id, payload);
            toast('success', 'Customer updated');
            navigate(`/customers/${id}`, { replace: true });
          }}
        />
      </Card>
      </div>
    </>
  );
}
