import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { customersApi, ordersApi, settleApi } from '../../api/endpoints';
import { parseCustomer } from '../../components/customers/CustomerForm';
import CustomerPicker, { CustomerChoice, earlierDuePaise } from '../../components/customers/CustomerPicker';
import OrderForm, { emptyOrderForm } from '../../components/orders/OrderForm';
import BackButton from '../../components/ui/BackButton';
import { PageTop } from '../../components/ui/Tabs';
import { LoadingState } from '../../components/ui/States';
import { useToast } from '../../context/ToastContext';
import { todayIST } from '../../lib/date';
import { formatINR, paiseToInput } from '../../lib/money';
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
  const settleKey = useRef(uuid());
  // Collect what the customer owes on earlier orders along with this one. Unticked whenever the customer changes.
  const [includeDues, setIncludeDues] = useState(false);
  const pickCustomer = (c: CustomerChoice) => {
    setChoice(c);
    setIncludeDues(false);
  };
  const duePaise = choice.mode === 'existing' && choice.customer ? earlierDuePaise(choice.customer) : 0;

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
    if (choice.mode === 'walkin') return {};
    if (choice.mode === 'existing') return choice.customer ? {} : { customerId: 'Select a customer, add a new one, or choose walk-in' };
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
        customerSection={(errors) => <CustomerPicker value={choice} onChange={pickCustomer} errors={errors} />}
        validateExtra={validateCustomer}
        earlierDues={{ amountPaise: duePaise, include: includeDues, onToggle: setIncludeDues }}
        submitLabel="Save order"
        onCancel={() => navigate(-1)}
        submit={async (payload) => {
          const customerPart =
            choice.mode === 'walkin'
              ? { walkIn: true }
              : choice.mode === 'existing'
                ? { customerId: choice.customer!.id }
                : { newCustomer: parseCustomer(choice.values).payload! };
          const order = await ordersApi.create({ ...payload, ...customerPart, idempotencyKey: idempotencyKey.current });
          if (includeDues && duePaise > 0 && choice.mode === 'existing' && choice.customer) {
            // Recorded after the order is saved; both calls carry a retry key, so saving again can't collect twice.
            try {
              await settleApi.save(choice.customer.id, {
                amount: paiseToInput(duePaise),
                method: payload.paymentMethod ?? 'cash',
                paidOn: todayIST(),
                reference: null,
                note: `Collected with ${order.orderNumber}`,
                idempotencyKey: settleKey.current,
              });
              toast('success', `Order ${order.orderNumber} saved, and ${formatINR(duePaise)} of earlier dues recorded`);
            } catch (err) {
              toast(
                'error',
                `Order ${order.orderNumber} saved, but the earlier dues weren't recorded${err instanceof ApiError ? `: ${err.message}` : ''}. Settle them from the customer's page.`,
              );
            }
          } else toast('success', `Order ${order.orderNumber} saved`);
          navigate(`/orders/${order.id}`, { replace: true, state: { justCreated: true } });
        }}
      />
      </div>
    </>
  );
}
