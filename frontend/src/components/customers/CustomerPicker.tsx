import { useEffect, useState } from 'react';
import { customersApi } from '../../api/endpoints';
import { useDebounced } from '../../lib/hooks';
import type { CustomerFormValues } from '../../schemas';
import type { Customer } from '../../types';
import Button from '../ui/Button';
import { TextField } from '../ui/Field';
import Spinner from '../ui/Spinner';
import { CustomerFields } from './CustomerForm';

export type CustomerChoice =
  | { mode: 'existing'; customer: Customer | null }
  | { mode: 'new'; values: CustomerFormValues }
  | { mode: 'walkin' };

export default function CustomerPicker({
  value,
  onChange,
  errors,
}: {
  value: CustomerChoice;
  onChange: (v: CustomerChoice) => void;
  errors: Record<string, string>;
}) {
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search);
  const [results, setResults] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const showSearch = value.mode === 'existing' && !value.customer;

  useEffect(() => {
    if (!showSearch) return;
    let cancelled = false;
    setLoading(true);
    setSearchError(null);
    customersApi
      .list({ search: debounced || undefined, pageSize: 8 })
      .then((r) => !cancelled && setResults(r.data))
      .catch((e: Error) => !cancelled && setSearchError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [debounced, showSearch]);

  if (value.mode === 'new') {
    const newErrors: Record<string, string> = {};
    for (const [k, v] of Object.entries(errors)) if (k.startsWith('newCustomer.')) newErrors[k.slice(12)] = v;
    return (
      <div className="space-y-4">
        <CustomerFields
          values={value.values}
          errors={newErrors}
          showNotes={false}
          existingCustomerId={Number(errors['newCustomer.existingCustomerId']) || undefined}
          onChange={(values) => onChange({ mode: 'new', values })}
        />
        <Button variant="ghost" size="sm" onClick={() => onChange({ mode: 'existing', customer: null })}>
          ← Pick an existing customer instead
        </Button>
      </div>
    );
  }

  if (value.mode === 'walkin') {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-wash px-4 py-3">
        <div>
          <p className="font-medium">Walk-in sale</p>
          <p className="text-sm text-ink-2">No customer saved. Usually paid in full at the counter — there’s no one to collect a balance from later.</p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => onChange({ mode: 'existing', customer: null })}>
          Choose a customer
        </Button>
      </div>
    );
  }

  if (value.customer) {
    const c = value.customer;
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-wash px-4 py-3">
        <div>
          <p className="font-medium">{c.name}</p>
          <p className="text-sm text-ink-2">
            {c.phone}
            {c.email ? ` · ${c.email}` : ''}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => onChange({ mode: 'existing', customer: null })}>
          Change
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <TextField
        label="Search customer"
        placeholder="Name or phone number"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        error={errors.customerId}
        autoFocus
      />
      <div className="max-h-72 overflow-y-auto rounded-lg border border-line">
        {loading ? (
          <div className="flex justify-center p-4 text-ink-4">
            <Spinner className="h-5 w-5" />
          </div>
        ) : searchError ? (
          <p className="p-4 text-sm text-danger">{searchError}</p>
        ) : results.length === 0 ? (
          <p className="p-4 text-sm text-ink-3">No customers found.</p>
        ) : (
          <ul className="divide-y divide-line">
            {results.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onChange({ mode: 'existing', customer: c })}
                  className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-wash"
                >
                  <span className="font-medium">{c.name}</span>
                  <span className="text-sm text-ink-3">{c.phone}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Button
        variant="secondary"
        onClick={() =>
          onChange({
            mode: 'new',
            values: {
              name: /\d/.test(search) ? '' : search,
              phone: /\d/.test(search) ? search : '',
              email: '',
              address: '',
              notes: '',
            },
          })
        }
      >
        + Add new customer
      </Button>
      <Button variant="ghost" onClick={() => onChange({ mode: 'walkin' })}>
        Walk-in sale (no customer)
      </Button>
    </div>
  );
}
