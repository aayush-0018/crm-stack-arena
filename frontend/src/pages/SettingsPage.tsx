import { FormEvent, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ApiError } from '../api/client';
import { shopApi } from '../api/endpoints';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import { PageTop } from '../components/ui/Tabs';
import { TextField } from '../components/ui/Field';
import LogoPicker from '../components/ui/LogoPicker';
import { Alert } from '../components/ui/States';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import type { Shop } from '../types';

type Values = Record<Exclude<keyof Shop, 'id' | 'logoKey' | 'allowNegativeStock'>, string>;
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
  const { shop, setShop, user } = useAuth();
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const isOwner = user?.role === 'owner';

  const changeLogo = async (run: () => Promise<Shop>, done: string) => {
    setLogoBusy(true);
    setLogoError(null);
    try {
      setShop(await run());
      toast('success', done);
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : 'Could not save the logo');
    } finally {
      setLogoBusy(false);
    }
  };
  const toast = useToast();
  const welcome = (useLocation().state as { welcome?: boolean | 'branch' } | null)?.welcome;
  const [values, setValues] = useState<Values>(toValues(shop));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stockBusy, setStockBusy] = useState(false);

  useEffect(() => setValues(toValues(shop)), [shop]);

  // Saved on its own, from the saved shop details, so unsaved edits above aren't sent with it.
  const setNegativeStock = async (allow: boolean) => {
    if (!shop) return;
    setStockBusy(true);
    try {
      const { id: _id, logoKey: _logo, ...saved } = shop;
      setShop(await shopApi.update({ ...saved, allowNegativeStock: allow }));
      toast('success', allow ? 'Orders can now take stock below zero' : 'Orders can no longer take stock below zero');
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Could not save');
    } finally {
      setStockBusy(false);
    }
  };

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
          {isOwner && (
            <div className="border-b border-line pb-5">
              <LogoPicker
                savedKey={shop?.logoKey}
                preview={null}
                busy={logoBusy}
                error={logoError}
                onPick={(png) => changeLogo(() => shopApi.uploadLogo(png), 'Logo updated')}
                onRemove={() => changeLogo(() => shopApi.removeLogo(), 'Logo removed')}
              />
            </div>
          )}
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

      <Card title="Stock" className="mt-5">
        <label className="flex cursor-pointer items-start gap-3 text-[14px]">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 accent-[#171717]"
            checked={!!shop?.allowNegativeStock}
            disabled={stockBusy || !isOwner}
            onChange={(e) => setNegativeStock(e.target.checked)}
          />
          <span>
            <span className="text-ink">Allow selling when stock runs out</span>
            <span className="mt-0.5 block text-[13px] text-ink-3">
              Off: an order that needs more than is in stock is refused, so your counts stay right. On: the sale goes through, the
              stock goes below zero and the product shows as low stock until you add stock or do a stock count.
            </span>
          </span>
        </label>
      </Card>
      </div>
    </>
  );
}
