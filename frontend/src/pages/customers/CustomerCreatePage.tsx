import { useNavigate } from 'react-router-dom';
import { customersApi } from '../../api/endpoints';
import CustomerForm from '../../components/customers/CustomerForm';
import BackButton from '../../components/ui/BackButton';
import Card from '../../components/ui/Card';
import { PageTop } from '../../components/ui/Tabs';
import { useToast } from '../../context/ToastContext';

export default function CustomerCreatePage() {
  const navigate = useNavigate();
  const toast = useToast();
  return (
    <>
      <PageTop leading={<BackButton to="/customers" label="Back to customers" />} title="Add customer" />
      <div className="max-w-3xl px-4 py-6 sm:px-6">
      <Card title="Customer details">
        <CustomerForm
          submitLabel="Save customer"
          onCancel={() => navigate(-1)}
          onSubmit={async (payload) => {
            const c = await customersApi.create(payload);
            toast('success', `Customer ${c.name} added`);
            navigate(`/customers/${c.id}`, { replace: true });
          }}
        />
      </Card>
      </div>
    </>
  );
}
