import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { customersApi, ordersApi } from '../../api/endpoints';
import { parseCustomer } from '../../components/customers/CustomerForm';
import CustomerPicker, { CustomerChoice } from '../../components/customers/CustomerPicker';
import OrderForm, { emptyOrderForm } from '../../components/orders/OrderForm';
import BackButton from '../../components/ui/BackButton';
import { PageTop } from '../../components/ui/Tabs';
import { LoadingState } from '../../components/ui/States';
import { useToast } from '../../context/ToastContext';
import { todayIST } from '../../lib/date';
import { uuid } from '../../lib/uuid';

export default function OrderCreatePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const presetId = params.get('customerId');
  const [choice, setChoice] = useState<CustomerChoice>({ mode: 'existing', customer: null });
  const [loadingPreset, setLoadingPreset] = useState(!!presetId);
  // One key per form session: a retry after a dropped connection can't create a duplicate order.
  const idempotencyKey = useRef(uuid());

  useEffect(() => {
    if (!presetId) return;
    customersApi
      .get(presetId)
      .then((c) => setChoice({ mode: 'existing', customer: c }))
      .catch(() => toast('error', 'Could not load the selected customer'))
      .finally(() => setLoadingPreset(false));
  }, [presetId, toast]);

  if (loadingPreset) return <LoadingState />;

  const validateCustomer = (): Record<string, string> => {
    if (choice.mode === 'existing') return choice.customer ? {} : { customerId: 'Select a customer or add a new one' };
    const { errors } = parseCustomer(choice.values);
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(errors ?? {})) out[`newCustomer.${k}`] = v;
    return out;
  };

  return (
    <>
      <PageTop leading={<BackButton to="/orders" label="Back to orders" />} title="New order" />
      <div className="max-w-5xl px-4 py-6 sm:px-6">
      <OrderForm
        initial={emptyOrderForm(todayIST())}
        customerChoice={choice}
        customerSection={(errors) => <CustomerPicker value={choice} onChange={setChoice} errors={errors} />}
        validateExtra={validateCustomer}
        submitLabel="Save order"
        onCancel={() => navigate(-1)}
        submit={async (payload) => {
          const customerPart =
            choice.mode === 'existing'
              ? { customerId: choice.customer!.id }
              : { newCustomer: parseCustomer(choice.values).payload! };
          const order = await ordersApi.create({ ...payload, ...customerPart, idempotencyKey: idempotencyKey.current });
          toast('success', `Order ${order.orderNumber} saved`);
          navigate(`/orders/${order.id}`, { replace: true, state: { justCreated: true } });
        }}
      />
      </div>
    </>
  );
}
