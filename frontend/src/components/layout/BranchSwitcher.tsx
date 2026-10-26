import { Check, ChevronDown, Plus, Settings } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { branchesApi } from '../../api/endpoints';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import type { Branch } from '../../types';
import Button from '../ui/Button';
import { TextField } from '../ui/Field';
import { Modal } from '../ui/Modal';
import Popover, { MenuItem, MenuLabel } from '../ui/Popover';
import ShopLogo from '../ui/ShopLogo';
import Spinner from '../ui/Spinner';
import { Alert } from '../ui/States';

/** "Vardhman Malviya Nagar" -> "VMN". */
const suggestCode = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 4);

/** Branch list + switching, used by the sidebar switcher. */
export function useBranches() {
  const { shop, switchBranch } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [branches, setBranches] = useState<Branch[]>([]);

  const reload = useCallback(() => {
    branchesApi
      .list()
      .then(setBranches)
      .catch(() => undefined);
  }, []);
  useEffect(reload, [reload, shop?.id]);

  const open = useCallback(
    async (b: Branch) => {
      if (b.id === shop?.id) return;
      try {
        await switchBranch(b.id);
        navigate('/'); // pages from the old branch (e.g. /orders/123) don't exist in the new one
        toast('success', `Switched to ${b.name}`);
      } catch (e) {
        toast('error', e instanceof Error ? e.message : 'Could not switch branch');
      }
    },
    [shop?.id, switchBranch, navigate, toast],
  );

  return { branches, reload, open, currentId: shop?.id };
}

export default function BranchSwitcher() {
  const { shop, user } = useAuth();
  const navigate = useNavigate();
  const { branches, reload, open, currentId } = useBranches();
  const [busy, setBusy] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const isOwner = branches.find((b) => b.id === currentId)?.role === 'owner' || user?.role === 'owner';

  return (
    <>
      <Popover
        width={264}
        trigger={({ toggle, open: isOpen }) => (
          <button
            type="button"
            onClick={() => {
              if (!isOpen) reload();
              toggle();
            }}
            aria-expanded={isOpen}
            aria-label={`Current branch: ${shop?.name ?? ''}. Switch branch`}
            className="flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1 text-left hover:bg-hover"
          >
            <ShopLogo logoKey={shop?.logoKey} name={shop?.name} size={32} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15.5px] font-semibold leading-tight text-ink">{shop?.name ?? 'Shop'}</span>
              {branches.length > 1 && (
                <span className="block truncate text-[11.5px] leading-tight text-ink-3">
                  {[shop?.code, shop?.city].filter(Boolean).join(' · ') || `${branches.length} branches`}
                </span>
              )}
            </span>
            <ChevronDown size={15} className="shrink-0 text-ink-2" />
          </button>
        )}
      >
        {(close) => (
          <>
            <MenuLabel>Branches</MenuLabel>
            <ul role="listbox" aria-label="Branches">
              {branches.map((b) => {
                const current = b.id === currentId;
                return (
                  <li key={b.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={current}
                      disabled={busy !== null}
                      onClick={async () => {
                        if (current) return close();
                        setBusy(b.id);
                        await open(b);
                        setBusy(null);
                        close();
                      }}
                      className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-hover ${current ? 'bg-hover/60' : ''}`}
                    >
                      {b.logoKey ? (
                        <ShopLogo logoKey={b.logoKey} name={b.name} size={28} />
                      ) : (
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line bg-white text-[10.5px] font-semibold text-ink-2">
                          {b.code ?? b.name.slice(0, 2).toUpperCase()}
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] text-ink">{b.name}</span>
                        {b.city && <span className="block truncate text-[11.5px] text-ink-3">{b.city}</span>}
                      </span>
                      {busy === b.id ? (
                        <Spinner className="h-3.5 w-3.5 text-ink-3" />
                      ) : current ? (
                        <Check size={15} strokeWidth={2.5} className="text-ink" />
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="mt-1 border-t border-line pt-1">
              {isOwner && (
                <MenuItem
                  icon={<Plus size={15} />}
                  onClick={() => {
                    close();
                    setAdding(true);
                  }}
                >
                  Add branch
                </MenuItem>
              )}
              <MenuItem
                icon={<Settings size={15} />}
                onClick={() => {
                  close();
                  navigate('/settings');
                }}
              >
                Branch settings
              </MenuItem>
            </div>
          </>
        )}
      </Popover>

      <AddBranchModal
        open={adding}
        onClose={() => setAdding(false)}
        onCreated={async (b, openNow) => {
          setAdding(false);
          reload();
          if (openNow) {
            await open(b);
            navigate('/settings', { state: { welcome: 'branch' } });
          }
        }}
      />
    </>
  );
}

function AddBranchModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (b: Branch, openNow: boolean) => void;
}) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [codeTouched, setCodeTouched] = useState(false);
  const [city, setCity] = useState('');
  const [phone, setPhone] = useState('');
  const [openNow, setOpenNow] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName('');
    setCode('');
    setCodeTouched(false);
    setCity('');
    setPhone('');
    setOpenNow(true);
    setErrors({});
    setFormError(null);
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setErrors({ name: 'Branch name is required' });
    setSaving(true);
    setErrors({});
    setFormError(null);
    try {
      const b = await branchesApi.create({
        name: name.trim(),
        code: code.trim() || null,
        city: city.trim() || null,
        phone: phone.trim() || null,
      });
      onCreated(b, openNow);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors);
        if (!Object.keys(err.fieldErrors).length) setFormError(err.message);
      } else setFormError('Could not create the branch. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} title="Add branch" onClose={saving ? () => undefined : onClose}>
      <form onSubmit={submit} noValidate className="space-y-4 pb-5">
        <p className="text-[13px] text-ink-3">
          A branch has its own customers, orders, invoices and numbering. You can switch between branches from the menu at any time.
        </p>
        {formError && <Alert tone="error">{formError}</Alert>}
        <TextField
          label="Branch name"
          required
          autoFocus
          placeholder="e.g. Vardhman Malviya Nagar"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (!codeTouched) setCode(suggestCode(e.target.value));
          }}
          error={errors.name}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Branch code"
            value={code}
            maxLength={6}
            onChange={(e) => {
              setCodeTouched(true);
              setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
            }}
            error={errors.code}
            hint={code ? `Invoices: INV-${code}-2026-000001` : 'Optional, 2–6 letters'}
          />
          <TextField label="City" value={city} onChange={(e) => setCity(e.target.value)} error={errors.city} />
        </div>
        <TextField label="Phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} error={errors.phone} />
        <label className="flex cursor-pointer items-center gap-2.5 text-[13.5px] text-ink-2">
          <input type="checkbox" checked={openNow} onChange={(e) => setOpenNow(e.target.checked)} className="h-3.5 w-3.5 accent-[#171717]" />
          Switch to this branch now
        </label>
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            Create branch
          </Button>
        </div>
      </form>
    </Modal>
  );
}
