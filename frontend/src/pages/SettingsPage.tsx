import { FormEvent, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ApiError } from '../api/client';
import { authApi, shopApi } from '../api/endpoints';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import { PageTop } from '../components/ui/Tabs';
import { TextField } from '../components/ui/Field';
import { Modal } from '../components/ui/Modal';
import LogoPicker from '../components/ui/LogoPicker';
import { Alert } from '../components/ui/States';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { MONTH_NAMES, sampleInvoiceNumber } from '../lib/fy';
import type { Shop } from '../types';

type Values = Record<Exclude<keyof Shop, 'id' | 'logoKey' | 'allowNegativeStock' | 'googleReviewUrl' | 'fyStartMonth'>, string>;
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
  const [review, setReview] = useState(shop?.googleReviewUrl ?? '');
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [fyBusy, setFyBusy] = useState(false);

  const setFinancialYear = async (month: number) => {
    setFyBusy(true);
    try {
      setShop(await shopApi.setFinancialYear(month));
      toast('success', `Financial year now starts in ${MONTH_NAMES[month - 1]}`);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Could not save');
    } finally {
      setFyBusy(false);
    }
  };

  useEffect(() => setValues(toValues(shop)), [shop]);
  useEffect(() => setReview(shop?.googleReviewUrl ?? ''), [shop]);

  // Saved on its own too. The server turns a Place ID into Google's review link.
  const saveReview = async (e: FormEvent) => {
    e.preventDefault();
    if (!shop) return;
    setReviewBusy(true);
    setReviewError(null);
    try {
      const { id: _id, logoKey: _logo, allowNegativeStock: _stock, ...saved } = shop;
      setShop(await shopApi.update({ ...saved, googleReviewUrl: review.trim() || null }));
      toast('success', review.trim() ? 'Guests will be asked to rate you on Google' : 'Google review step turned off');
    } catch (err) {
      setReviewError(err instanceof ApiError ? (err.fieldErrors.googleReviewUrl ?? err.message) : 'Could not save. Please try again.');
    } finally {
      setReviewBusy(false);
    }
  };

  // Saved on its own, from the saved shop details, so unsaved edits above aren't sent with it.
  const setNegativeStock = async (allow: boolean) => {
    if (!shop) return;
    setStockBusy(true);
    try {
      const { id: _id, logoKey: _logo, googleReviewUrl: _review, ...saved } = shop;
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
              hint={values.code ? `New invoices: ${sampleInvoiceNumber(values.code, shop?.fyStartMonth)}` : 'Optional. Keeps invoice numbers unique across branches.'}
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

      <Card title="Financial year" className="mt-5">
        <div className="space-y-3">
          <label className="block max-w-xs">
            <span className="mb-1.5 block text-[13px] font-medium text-ink-2">Financial year starts in</span>
            <select
              className="block h-9 w-full rounded-lg border border-line bg-surface px-3 pr-8 text-[14px] text-ink shadow-soft disabled:opacity-60"
              value={shop?.fyStartMonth ?? 1}
              disabled={fyBusy || !isOwner}
              onChange={(e) => setFinancialYear(Number(e.target.value))}
            >
              {MONTH_NAMES.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                  {i === 0 ? ' (calendar year)' : i === 3 ? ' (India: April to March)' : ''}
                </option>
              ))}
            </select>
          </label>
          <p className="text-[13px] text-ink-3">
            Used for quarters and years on the Growth page, and for the year printed in new invoice, receipt, refund and return numbers
            (next invoice: <span className="text-ink-2">{sampleInvoiceNumber(shop?.code ?? '', shop?.fyStartMonth)}</span>). Numbers already
            issued don't change, and the running number carries on. Applies to all your branches.
            {!isOwner && ' Only an owner can change it.'}
          </p>
        </div>
      </Card>

      <Card title="Stock" className="mt-5">
        <label className="flex cursor-pointer items-start gap-3 text-[14px]">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 accent-ink"
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

      <Card title="Google reviews" className="mt-5">
        <form onSubmit={saveReview} noValidate className="space-y-4">
          <p className="text-[13px] text-ink-3">
            After ordering from a table QR code, guests are taken straight to your Google review box (stars and a text box). The
            table game doesn't depend on it, as Google doesn't allow rewards for reviews. Leave blank to skip the review step.
          </p>
          <div className="text-[13px] text-ink-3">
            <p className="text-ink">To find your Place ID:</p>
            <ol className="mt-1 list-decimal space-y-0.5 pl-5">
              <li>
                Open Google's{' '}
                <a
                  href="https://developers.google.com/maps/documentation/javascript/examples/places-placeid-finder"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-ink-2 underline underline-offset-2"
                >
                  Place ID Finder
                </a>
                .
              </li>
              <li>In the search box on the map, type your shop's name and area, and pick your shop from the list.</li>
              <li>
                Copy the code after <span className="text-ink">Place ID:</span> (it starts with <span className="text-ink">ChIJ</span>). Copy and
                paste it rather than typing, as letters like l and I look alike.
              </li>
              <li>Paste it below, save, and check it with "Open the review page".</li>
            </ol>
            <p className="mt-2">
              If you manage your Google Business Profile, you can paste the link from <span className="text-ink">Ask for reviews</span> instead.
            </p>
          </div>
          <TextField
            label="Review link or Place ID"
            value={review}
            disabled={!isOwner}
            onChange={(e) => {
              setReview(e.target.value);
              setReviewError(null);
            }}
            error={reviewError ?? undefined}
            placeholder="ChIJ… or https://g.page/r/…/review"
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" loading={reviewBusy} disabled={!isOwner}>
              Save
            </Button>
            {shop?.googleReviewUrl && (
              <a href={shop.googleReviewUrl} target="_blank" rel="noopener noreferrer" className="text-[13.5px] text-ink-2 underline underline-offset-2">
                Open the review page
              </a>
            )}
          </div>
        </form>
      </Card>

      <PrivacyCard />
      </div>
    </>
  );
}

/** Policies, and deleting the account (DPDP right to erasure). */
function PrivacyCard() {
  const { logout } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const close = () => {
    if (busy) return;
    setOpen(false);
    setPassword('');
    setTyped('');
    setError(null);
  };
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await authApi.deleteAccount(password);
      toast('success', 'Your account has been deleted');
      logout();
    } catch (err) {
      setError(err instanceof ApiError ? (err.fieldErrors.password ?? err.message) : 'Could not delete the account. Please try again.');
      setBusy(false);
    }
  };

  return (
    <Card title="Privacy" className="mt-5">
      <p className="text-[13.5px] text-ink-2">
        Read our{' '}
        <Link to="/privacy" className="text-ink underline underline-offset-2">
          Privacy Policy
        </Link>
        ,{' '}
        <Link to="/terms" className="text-ink underline underline-offset-2">
          Terms
        </Link>
        ,{' '}
        <Link to="/refunds" className="text-ink underline underline-offset-2">
          Refund Policy
        </Link>{' '}
        and{' '}
        <Link to="/cookies" className="text-ink underline underline-offset-2">
          Cookie Policy
        </Link>
        . To download your data, use the CSV export on each list.
      </p>
      <div className="mt-4 rounded-xl border border-danger-line p-4">
        <p className="text-[14px] font-medium text-ink">Delete account</p>
        <p className="mt-1 text-[13px] text-ink-2">
          Permanently deletes your login and every branch only you own, with all its customers, orders, invoices, products, staff and expenses.
          Branches you share with another owner stay with them. This can’t be undone, so download anything you need first.
        </p>
        <Button variant="danger" size="sm" className="mt-3" onClick={() => setOpen(true)}>
          Delete account
        </Button>
      </div>
      <Modal
        open={open}
        title="Delete your account?"
        onClose={close}
        footer={
          <>
            <Button variant="secondary" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={run} loading={busy} disabled={!password || typed.trim().toUpperCase() !== 'DELETE'}>
              Delete everything
            </Button>
          </>
        }
      >
        <form
          className="space-y-3.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (password && typed.trim().toUpperCase() === 'DELETE') run();
          }}
        >
          {error && <Alert tone="error">{error}</Alert>}
          <p className="text-[13.5px] text-ink-2">All your data will be erased immediately. This can’t be undone.</p>
          <TextField label="Your password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          <TextField label="Type DELETE to confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          <button type="submit" hidden />
        </form>
      </Modal>
    </Card>
  );
}
