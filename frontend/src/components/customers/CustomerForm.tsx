import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../../api/client';
import type { CustomerPayload } from '../../api/endpoints';
import { zodErrors } from '../../lib/zod';
import { customerSchema, CustomerFormValues } from '../../schemas';
import type { Customer } from '../../types';
import Button from '../ui/Button';
import { TextAreaField, TextField } from '../ui/Field';
import { Alert } from '../ui/States';

export const emptyCustomer: CustomerFormValues = { name: '', phone: '', email: '', address: '', notes: '' };

export const customerToForm = (c: Customer): CustomerFormValues => ({
  name: c.name,
  phone: c.phone,
  email: c.email ?? '',
  address: c.address ?? '',
  notes: c.notes ?? '',
});

/** Validates form values; returns payload or field errors. */
export function parseCustomer(values: CustomerFormValues): { payload?: CustomerPayload; errors?: Record<string, string> } {
  const r = customerSchema.safeParse(values);
  if (!r.success) return { errors: zodErrors(r.error) };
  const v = r.data;
  return {
    payload: { name: v.name, phone: v.phone, email: v.email || null, address: v.address || null, notes: v.notes || null },
  };
}

/** Name / phone / email / address fields. Reused inline in the order form. */
export function CustomerFields({
  values,
  errors,
  onChange,
  showNotes = true,
  existingCustomerId,
}: {
  values: CustomerFormValues;
  errors: Record<string, string>;
  onChange: (v: CustomerFormValues) => void;
  showNotes?: boolean;
  existingCustomerId?: number;
}) {
  const set = (k: keyof CustomerFormValues) => (e: { target: { value: string } }) =>
    onChange({ ...values, [k]: e.target.value });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <TextField label="Name" required value={values.name} onChange={set('name')} error={errors.name} autoComplete="off" />
      <TextField
        label="Phone"
        required
        inputMode="tel"
        value={values.phone}
        onChange={set('phone')}
        error={errors.phone}
        placeholder="98765 43210"
        hint={
          existingCustomerId ? (
            <Link className="text-ink underline" to={`/customers/${existingCustomerId}`}>
              View existing customer
            </Link>
          ) : undefined
        }
      />
      <TextField label="Email" type="email" value={values.email} onChange={set('email')} error={errors.email} />
      <TextField label="Address" value={values.address} onChange={set('address')} error={errors.address} />
      {showNotes && (
        <TextAreaField label="Notes" className="sm:col-span-2" value={values.notes} onChange={set('notes')} error={errors.notes} />
      )}
    </div>
  );
}

export default function CustomerForm({
  initial = emptyCustomer,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: CustomerFormValues;
  submitLabel: string;
  onSubmit: (payload: CustomerPayload) => Promise<void>;
  onCancel?: () => void;
}) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [existingId, setExistingId] = useState<number | undefined>();
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setExistingId(undefined);
    const { payload, errors: v } = parseCustomer(values);
    if (!payload) return setErrors(v ?? {});
    setErrors({});
    setSaving(true);
    try {
      await onSubmit(payload);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors);
        if (err.code === 'PHONE_EXISTS') setExistingId(Number(err.details?.existingCustomerId) || undefined);
        if (!Object.keys(err.fieldErrors).length) setFormError(err.message);
      } else setFormError('Could not save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      {formError && <Alert tone="error">{formError}</Alert>}
      <CustomerFields values={values} errors={errors} onChange={setValues} existingCustomerId={existingId} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={saving}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button variant="secondary" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
