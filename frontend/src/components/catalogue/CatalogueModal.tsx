import { Check, Copy, Download, ExternalLink, MessageCircle, Share2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiError } from '../../api/client';
import { catalogueApi, CatalogueSettingsPayload } from '../../api/endpoints';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import type { CatalogueSettings, CatalogueTemplate } from '../../types';
import Button from '../ui/Button';
import Checkbox from '../ui/Checkbox';
import { controlClass, TextField } from '../ui/Field';
import { Modal } from '../ui/Modal';
import ShopLogo from '../ui/ShopLogo';
import Spinner from '../ui/Spinner';
import { Alert } from '../ui/States';
import { CATALOGUE_TEMPLATES } from './templates';

const linkFor = (token: string) => `${window.location.origin}/c/${token}`;

const toForm = (c: CatalogueSettings): CatalogueSettingsPayload => ({
  template: c.template,
  title: c.title ?? '',
  tagline: c.tagline ?? '',
  showPrices: c.showPrices,
  hideOutOfStock: c.hideOutOfStock,
  showBranches: c.showBranches,
});

/** A small picture of the Classic cover, with the shop's own logo and name. */
function CoverThumb({ name, logoKey }: { name: string; logoKey: string | null }) {
  return (
    <div className="theme-light flex aspect-[3/4] w-[132px] shrink-0 flex-col items-center justify-between rounded-md border border-[#e3daca] bg-[#fbf8f1] p-2.5 text-center shadow-soft">
      <span className="text-[6.5px] uppercase tracking-[0.2em] text-[#5e574c]">Product catalogue</span>
      <span className="flex flex-col items-center">
        <ShopLogo logoKey={logoKey} name={name} size={34} />
        <span className="mt-2 line-clamp-2 font-serif text-[13px] leading-tight text-[#1e1b16]">{name}</span>
        <span className="mt-1.5 text-[7px] text-[#8c2f1b]">◆</span>
      </span>
      <span className="grid w-full grid-cols-3 gap-1">
        {['#f6e7cf', '#e3ebdd', '#f3ded6'].map((c) => (
          <span key={c} className="aspect-square rounded-[2px]" style={{ background: c }} />
        ))}
      </span>
    </div>
  );
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <div className="flex cursor-pointer items-start gap-3" onClick={() => onChange(!checked)}>
      <span className="mt-0.5">
        <Checkbox checked={checked} onChange={onChange} label={label} />
      </span>
      <span className="text-[13.5px]">
        <span className="text-ink">{label}</span>
        <span className="block text-[12.5px] text-ink-3">{hint}</span>
      </span>
    </div>
  );
}

/**
 * Turns the product list into a catalogue customers can open from a link. The link is live: it always
 * shows the branch's current products and prices, so it never needs generating again.
 */
export default function CatalogueModal({ open, onClose, productCount }: { open: boolean; onClose: () => void; productCount: number | null }) {
  const { shop, user } = useAuth();
  const toast = useToast();
  const isOwner = user?.role === 'owner';
  const [cat, setCat] = useState<CatalogueSettings | null | undefined>(undefined);
  const [form, setForm] = useState<CatalogueSettingsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<'create' | 'save' | 'reset' | 'off' | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState<'reset' | 'off' | null>(null);

  const load = (c: CatalogueSettings | null) => {
    setCat(c);
    setForm(c && toForm(c));
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setCat(undefined);
    setError(null);
    setFieldErrors({});
    setConfirm(null);
    setCopied(false);
    catalogueApi
      .get()
      .then((c) => !cancelled && load(c))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [open]);

  const run = async (kind: NonNullable<typeof busy>, fn: () => Promise<CatalogueSettings>, done?: string) => {
    setBusy(kind);
    setError(null);
    setFieldErrors({});
    try {
      load(await fn());
      if (done) toast('success', done);
    } catch (e) {
      if (e instanceof ApiError) {
        setFieldErrors(e.fieldErrors);
        setError(e.message);
      } else setError('Something went wrong. Please try again.');
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  };

  const url = cat?.token ? linkFor(cat.token) : null;
  const localOnly = url && /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(url);
  const message = url ? `Namaste! Here is the product catalogue of ${shop?.name ?? 'our shop'}. Have a look and message us to order:\n${url}` : '';
  const dirty = !!(cat && form && JSON.stringify(toForm(cat)) !== JSON.stringify(form));

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast('error', 'Could not copy — select the link and copy it manually');
    }
  };

  const nativeShare = async () => {
    try {
      await navigator.share({ title: `${shop?.name ?? ''} catalogue`, text: message });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast('error', 'Could not open the share sheet');
    }
  };

  const save = () =>
    form &&
    run(
      'save',
      () => catalogueApi.update({ ...form, title: form.title?.trim() || null, tagline: form.tagline?.trim() || null }),
      'Catalogue updated. The link shows the changes right away.',
    );

  return (
    <Modal open={open} title="Product catalogue" onClose={onClose} size="lg">
      <div className="space-y-4 pb-5">
        {error && <Alert tone="error">{error}</Alert>}

        {cat === undefined && !error ? (
          <div className="flex items-center gap-2 py-8 text-ink-3">
            <Spinner className="h-4 w-4" /> Loading…
          </div>
        ) : cat === undefined ? null : !cat?.token ? (
          /* Not created yet, or the link is turned off */
          <>
            <div className="flex gap-4">
              <CoverThumb name={shop?.name ?? ''} logoKey={shop?.logoKey ?? null} />
              <div className="min-w-0 text-[13.5px]">
                <p className="text-ink">
                  Turn your products into a catalogue with your logo, categories, prices and store addresses, then send customers one link.
                </p>
                <ul className="mt-2 list-disc space-y-0.5 pl-4 text-ink-3">
                  <li>Always up to date: new products and price changes show automatically.</li>
                  <li>Customers can search, call or WhatsApp you, and save it as a PDF.</li>
                  <li>Never shows cost prices or stock quantities.</li>
                </ul>
              </div>
            </div>
            {productCount === 0 && <Alert tone="warning">Add a few products first: the catalogue shows your active products.</Alert>}
            {!shop?.logoKey && isOwner && (
              <p className="text-[12.5px] text-ink-3">Tip: add your logo in Settings and it appears on the cover.</p>
            )}
            {isOwner ? (
              <Button className="w-full" loading={busy === 'create'} disabled={productCount === 0} onClick={() => run('create', catalogueApi.enable)}>
                {cat ? 'Turn the link on again' : 'Create catalogue'}
              </Button>
            ) : (
              <Alert tone="info">Ask an owner of this branch to create the catalogue. Once it's ready you can share it from here.</Alert>
            )}
          </>
        ) : (
          /* Ready to share */
          <>
            {localOnly && (
              <Alert tone="info">You're running locally, so this link only opens on this computer. Customers can open it once the app is deployed.</Alert>
            )}
            <div className="flex items-center gap-2">
              <input readOnly value={url!} aria-label="Catalogue link" onFocus={(e) => e.target.select()} className={controlClass(false, 'h-9 flex-1 truncate text-[13px] text-ink-2')} />
              <Button size="sm" variant="secondary" onClick={copy}>
                {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
              </Button>
              <a href={url!} target="_blank" rel="noopener noreferrer" aria-label="Open catalogue" title="Open catalogue" className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-2 hover:bg-hover hover:text-ink">
                <ExternalLink size={16} />
              </a>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <Button className="w-full" onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer')}>
                <MessageCircle size={15} /> Send on WhatsApp
              </Button>
              <Button variant="secondary" className="w-full" onClick={() => window.open(`${url}?print=1`, '_blank', 'noopener,noreferrer')}>
                <Download size={15} /> Download PDF
              </Button>
              {typeof navigator.share === 'function' && (
                <Button variant="secondary" className="w-full sm:col-span-2" onClick={nativeShare}>
                  <Share2 size={15} /> Share…
                </Button>
              )}
            </div>
            <p className="text-[12px] text-ink-3">
              Anyone with this link can view the catalogue, no login needed. It always shows your current active products
              {cat.hideOutOfStock ? ' that are in stock' : ''}.
            </p>

            {isOwner && form && (
              <div className="space-y-4 border-t border-line pt-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3">Design and options</p>
                <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Design">
                  {(Object.keys(CATALOGUE_TEMPLATES) as CatalogueTemplate[]).map((k) => (
                    <button
                      key={k}
                      type="button"
                      role="radio"
                      aria-checked={form.template === k}
                      onClick={() => setForm({ ...form, template: k })}
                      className={`rounded-lg border p-3 text-left ${form.template === k ? 'border-ink ring-1 ring-ink' : 'border-line hover:bg-hover'}`}
                    >
                      <span className="block text-[13.5px] font-medium text-ink">{CATALOGUE_TEMPLATES[k].label}</span>
                      <span className="mt-0.5 block text-[12px] leading-snug text-ink-3">{CATALOGUE_TEMPLATES[k].description}</span>
                    </button>
                  ))}
                  <div className="flex items-center justify-center rounded-lg border border-dashed border-line p-3 text-center text-[12.5px] text-ink-3">
                    More designs coming soon
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <TextField
                    label="Title"
                    placeholder="Product Catalogue"
                    maxLength={80}
                    value={form.title ?? ''}
                    error={fieldErrors.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                  />
                  <TextField
                    label="Tagline"
                    placeholder="e.g. Quality groceries since 1998"
                    maxLength={160}
                    value={form.tagline ?? ''}
                    error={fieldErrors.tagline}
                    onChange={(e) => setForm({ ...form, tagline: e.target.value })}
                  />
                </div>
                <div className="space-y-3">
                  <Toggle checked={form.showPrices} onChange={(v) => setForm({ ...form, showPrices: v })} label="Show prices" hint="Off: each item says “Price on request”." />
                  <Toggle
                    checked={form.hideOutOfStock}
                    onChange={(v) => setForm({ ...form, hideOutOfStock: v })}
                    label="Hide out-of-stock items"
                    hint="Off: they show, marked “Out of stock”. Items without stock tracking always show."
                  />
                  <Toggle
                    checked={form.showBranches}
                    onChange={(v) => setForm({ ...form, showBranches: v })}
                    label="Show all my stores"
                    hint="Adds the address and phone of your other branches. This branch's address always shows."
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" onClick={save} loading={busy === 'save'} disabled={!dirty}>
                    Save changes
                  </Button>
                  {dirty && (
                    <Button size="sm" variant="ghost" onClick={() => setForm(toForm(cat))}>
                      Undo
                    </Button>
                  )}
                </div>
                <p className="text-[12px] text-ink-3">
                  Store addresses come from Settings.{' '}
                  <button
                    type="button"
                    className="underline-offset-2 hover:text-ink hover:underline"
                    onClick={() => (confirm === 'reset' ? run('reset', catalogueApi.resetLink, 'New link ready. The old link no longer opens.') : setConfirm('reset'))}
                  >
                    {confirm === 'reset' ? 'Click again to reset: links already sent will stop working' : 'Reset link'}
                  </button>
                  {' · '}
                  <button
                    type="button"
                    className="underline-offset-2 hover:text-danger hover:underline"
                    onClick={() => (confirm === 'off' ? run('off', catalogueApi.turnOff, 'Catalogue link turned off.') : setConfirm('off'))}
                  >
                    {confirm === 'off' ? 'Click again to turn off: the link will stop opening' : 'Turn off link'}
                  </button>
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
