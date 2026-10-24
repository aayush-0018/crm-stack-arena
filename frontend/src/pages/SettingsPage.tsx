import { FormEvent, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ApiError } from '../api/client';
import { shopApi } from '../api/endpoints';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import { PageTop } from '../components/ui/Tabs';
import { TextField } from '../components/ui/Field';
import { Alert } from '../components/ui/States';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import type { Shop } from '../types';

type Values = Record<Exclude<keyof Shop, 'id'>, string>;
const toValues = (s: Shop | null): Values => ({
  name: s?.name ?? '',
  phone: s?.phone ?? '',
  email: s?.email ?? '',
  addressLine1: s?.addressLine1 ?? '',
  addressLine2: s?.addressLine2 ?? '',
  city: s?.city ?? '',
  state: s?.state ?? '',
  pincode: s?.pincode ?? '',
  gstin: s?.gstin ?? '',
  code: s?.code ?? '',
});

export default function SettingsPage() {
  const { shop, setShop } = useAuth();
  const toast = useToast();
  const welcome = (useLocation().state as { welcome?: boolean | 'branch' } | null)?.welcome;
  const [values, setValues] = useState<Values>(toValues(shop));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setValues(toValues(shop)), [shop]);

  const set = (k: keyof Values) => (e: { target: { value: string } }) => setValues({ ...values, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!values.name.trim()) return setErrors({ name: 'Shop name is required' });
    setErrors({});
    setBusy(true);
    try {
      const blankToNull = (v: string) => v.trim() || null;
      const updated = await shopApi.update({
        name: values.name.trim(),
        phone: blankToNull(values.phone),
        email: blankToNull(values.email),
        addressLine1: blankToNull(values.addressLine1),
        addressLine2: blankToNull(values.addressLine2),
        city: blankToNull(values.city),
        state: blankToNull(values.state),
        pincode: blankToNull(values.pincode),
        gstin: blankToNull(values.gstin),
        code: blankToNull(values.code.toUpperCase()),
      });
      setShop(updated);
      toast('success', 'Shop details saved');
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors);
        setFormError(err.message);
      } else setFormError('Could not save. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageTop title="Shop settings" />
      <div className="max-w-3xl px-4 py-6 sm:px-6">
      {welcome && (
        <div className="mb-4">
          <Alert tone="success">
            {welcome === 'branch'
              ? 'Your new branch is ready. Add its address and phone so they appear on its invoices.'
              : 'Your shop is ready. Add your address and phone so they appear on invoices.'}
          </Alert>
        </div>
      )}
      <Card title="Shop details" actions={<span className="text-[12.5px] text-ink-3">Printed on new invoices</span>}>
        <form onSubmit={submit} noValidate className="space-y-5">
          {formError && <Alert tone="error">{formError}</Alert>}
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Shop name" required value={values.name} onChange={set('name')} error={errors.name} />
            <TextField
              label="Branch code"
              value={values.code}
              maxLength={6}
              onChange={(e) => setValues({ ...values, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })}
              error={errors.code}
              hint={values.code ? `New invoices: INV-${values.code}-2026-000001` : 'Optional. Keeps invoice numbers unique across branches.'}
            />
            <TextField label="Phone" inputMode="tel" value={values.phone} onChange={set('phone')} error={errors.phone} />
            <TextField label="Email" type="email" value={values.email} onChange={set('email')} error={errors.email} />
            <TextField label="GSTIN" value={values.gstin} onChange={set('gstin')} error={errors.gstin} hint="Optional, 15 characters" />
            <TextField label="Address line 1" value={values.addressLine1} onChange={set('addressLine1')} error={errors.addressLine1} />
            <TextField label="Address line 2" value={values.addressLine2} onChange={set('addressLine2')} error={errors.addressLine2} />
            <TextField label="City" value={values.city} onChange={set('city')} error={errors.city} />
            <TextField label="State" value={values.state} onChange={set('state')} error={errors.state} />
            <TextField label="Pincode" inputMode="numeric" value={values.pincode} onChange={set('pincode')} error={errors.pincode} />
          </div>
          <Button type="submit" loading={busy}>
            Save
          </Button>
        </form>
      </Card>
      </div>
    </>
  );
}
