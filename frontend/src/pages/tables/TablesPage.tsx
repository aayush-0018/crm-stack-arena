import { ChefHat, Download, ExternalLink, Printer, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { floorPlanApi, kitchenApi } from '../../api/endpoints';
import { PAYMENT_METHOD_LABEL, PAYMENT_METHODS } from '../../components/orders/Payments';
import FloorCanvas from '../../components/tables/FloorCanvas';
import FloorPlanEditor from '../../components/tables/FloorPlanEditor';
import QrImage, { useQrDataUrl } from '../../components/tables/QrImage';
import { KITCHEN_LABEL, NEXT_STATUS, qty, since, TABLE_STATE, tableState, tableUrl, usePolling, useNow } from '../../components/tables/dinein';
import { Pill } from '../../components/ui/Badge';
import Button, { ButtonLink } from '../../components/ui/Button';
import { controlClass } from '../../components/ui/Field';
import ShopLogo from '../../components/ui/ShopLogo';
import { Alert, EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { PageTop } from '../../components/ui/Tabs';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { formatINR } from '../../lib/money';
import type { FloorPlan, KitchenOrder, PaymentMethod } from '../../types';

type Tab = 'live' | 'plan' | 'qr';
type Live = FloorPlan & { orders: KitchenOrder[] };

/** Click a table: its open orders, with serve and payment actions. */
function TablePanel({ label, orders, onClose, onChange }: { label: string; orders: KitchenOrder[]; onClose: () => void; onChange: (l: Live | null) => void }) {
  const toast = useToast();
  const now = useNow();
  const [method, setMethod] = useState<Exclude<PaymentMethod, 'unrecorded'>>('cash');
  const [busy, setBusy] = useState<number | null>(null);
  const act = async (id: number, fn: () => Promise<unknown>, done: string) => {
    setBusy(id);
    try {
      const r = await fn();
      onChange(r && typeof r === 'object' && 'orders' in (r as object) ? (r as Live) : null);
      toast('success', done);
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  };
  const due = orders.reduce((s, o) => s + o.totalPaise - o.amountPaidPaise, 0);

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[16px] font-medium text-ink">Table {label}</h3>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-ink-3 hover:bg-hover hover:text-ink">
          <X size={16} />
        </button>
      </div>
      {orders.length === 0 ? (
        <p className="text-[13.5px] text-ink-3">No open orders. The table is free.</p>
      ) : (
        <div className="space-y-3">
          {orders.map((o) => {
            const next = NEXT_STATUS[o.kitchenStatus];
            const owed = o.totalPaise - o.amountPaidPaise;
            return (
              <div key={o.id} className="rounded-lg border border-line p-3 text-[13.5px]">
                <div className="flex items-center justify-between gap-2">
                  <Link to={`/orders/${o.id}`} className="font-medium text-ink hover:underline">
                    {o.orderNumber}
                  </Link>
                  <span className="text-[12px] text-ink-3">{since(o.createdAt, now)}</span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <Pill tone={o.kitchenStatus === 'ready' ? 'green' : o.kitchenStatus === 'new' ? 'amber' : o.kitchenStatus === 'served' ? 'gray' : 'blue'}>{KITCHEN_LABEL[o.kitchenStatus]}</Pill>
                  <Pill tone={o.paymentStatus === 'paid' ? 'green' : o.paymentStatus === 'partial' ? 'amber' : 'red'}>{o.paymentStatus === 'paid' ? 'Paid' : owed < o.totalPaise ? `${formatINR(owed)} due` : 'Unpaid'}</Pill>
                </div>
                <ul className="mt-2 space-y-0.5 text-ink-2">
                  {o.items.map((it, i) => (
                    <li key={i}>
                      {qty(it.quantity)} × {it.itemName}
                    </li>
                  ))}
                </ul>
                {(o.guestName || o.notes) && <p className="mt-1.5 text-[12.5px] text-ink-3">{[o.guestName, o.notes].filter(Boolean).join(' · ')}</p>}
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <span className="mr-auto font-medium tabular-nums text-ink">{formatINR(o.totalPaise)}</span>
                  {next && (
                    <Button size="sm" variant="secondary" loading={busy === o.id} onClick={() => act(o.id, () => kitchenApi.setStatus(o.id, next), `Marked ${KITCHEN_LABEL[next].toLowerCase()}`)}>
                      Mark {KITCHEN_LABEL[next].toLowerCase()}
                    </Button>
                  )}
                  {owed > 0 && (
                    <Button size="sm" loading={busy === o.id} onClick={() => act(o.id, () => kitchenApi.markPaid(o.id, method), `${formatINR(owed)} received`)}>
                      Mark paid
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
          {due > 0 && (
            <label className="flex items-center justify-between gap-2 text-[13px] text-ink-2">
              Payment method for “Mark paid”
              <select className={controlClass(false, 'h-8 w-28')} value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
                {(PAYMENT_METHODS as Exclude<PaymentMethod, 'unrecorded'>[]).map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_METHOD_LABEL[m]}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
    </div>
  );
}

function LiveFloor() {
  const [live, setLive] = useState<Live | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const now = useNow();
  const load = useCallback(
    () =>
      floorPlanApi
        .live()
        .then((l) => {
          setLive(l);
          setError(null);
        })
        .catch((e: Error) => setError(e)),
    [],
  );
  usePolling(load, 5000);

  const byTable = useMemo(() => {
    const m = new Map<number, KitchenOrder[]>();
    for (const o of live?.orders ?? []) if (o.tableId) m.set(o.tableId, [...(m.get(o.tableId) ?? []), o]);
    return m;
  }, [live]);

  if (error && !live) return <ErrorState error={error} onRetry={load} />;
  if (!live) return <LoadingState />;
  if (!live.tables.length) {
    return <EmptyState title="No tables yet" description="Draw your floor plan first: add your tables, then print their QR codes." action={<ButtonLink to="/tables?tab=plan">Draw floor plan</ButtonLink>} />;
  }

  const counts = live.tables.reduce<Record<string, number>>((acc, t) => {
    const s = tableState(byTable.get(t.id) ?? []);
    acc[s] = (acc[s] ?? 0) + 1;
    return acc;
  }, {});
  const sel = live.tables.find((t) => t.id === selected);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-ink-2">
        {(Object.keys(TABLE_STATE) as (keyof typeof TABLE_STATE)[]).map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full ${TABLE_STATE[k].dot}`} />
            {TABLE_STATE[k].label} <span className="tabular-nums text-ink-3">{counts[k] ?? 0}</span>
          </span>
        ))}
        <span className="ml-auto inline-flex items-center gap-1 text-[12px] text-ink-3">
          <RefreshCw size={12} /> Updates every few seconds
        </span>
      </div>
      <div className={`grid gap-4 ${sel ? 'lg:grid-cols-[minmax(0,1fr)_320px]' : ''}`}>
        <FloorCanvas
          width={live.width}
          height={live.height}
          decor={live.decor}
          tables={live.tables}
          selected={sel ? (`t${live.tables.indexOf(sel)}` as const) : null}
          tableTone={(t) => TABLE_STATE[tableState(byTable.get(t.id!) ?? [])].tone}
          tableBadge={(t) => {
            const orders = byTable.get(t.id!) ?? [];
            if (!orders.length) return null;
            const oldest = orders[0].createdAt;
            return (
              <span className="mt-0.5 text-[10px] font-medium leading-none opacity-80">
                {orders.length > 1 ? `${orders.length} orders · ` : ''}
                {since(oldest, now)}
              </span>
            );
          }}
          onTableClick={(t) => setSelected(t.id === selected ? null : t.id!)}
        />
        {sel && <TablePanel label={sel.label} orders={byTable.get(sel.id) ?? []} onClose={() => setSelected(null)} onChange={(l) => (l ? setLive(l) : load())} />}
      </div>
    </div>
  );
}

function QrCard({ shopName, logoKey, label, token }: { shopName: string; logoKey: string | null; label: string; token: string }) {
  const url = tableUrl(token);
  const png = useQrDataUrl(url, 400);
  return (
    <div className="qr-card flex flex-col items-center rounded-2xl border border-line bg-white p-5 text-center text-[#171717]">
      <div className="flex items-center gap-2">
        <ShopLogo logoKey={logoKey} name={shopName} size={26} />
        <span className="max-w-[180px] truncate text-[13.5px] font-medium">{shopName}</span>
      </div>
      <p className="mt-3 text-[30px] font-semibold leading-none tracking-tight">{label}</p>
      <div className="mt-3 rounded-xl border border-[#e5e5e2] p-2">
        <QrImage text={url} size={168} label={`QR code for table ${label}`} />
      </div>
      <p className="mt-3 text-[13px] font-medium">Scan to see the menu and order</p>
      <p className="mt-0.5 text-[11px] text-[#8f8f8a]">No app needed · Powered by CartWell</p>
      <div className="no-print mt-3 flex gap-1">
        {png && (
          <a href={png} download={`table-${label}.png`} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] text-[#5f5f5b] hover:bg-[#efefec]">
            <Download size={13} /> PNG
          </a>
        )}
        <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] text-[#5f5f5b] hover:bg-[#efefec]">
          <ExternalLink size={13} /> Open
        </a>
      </div>
    </div>
  );
}

function QrSheet({ plan, onChange }: { plan: FloorPlan; onChange: (p: FloorPlan) => void }) {
  const { shop, user } = useAuth();
  const toast = useToast();
  const [confirm, setConfirm] = useState<number | null>(null);
  const localOnly = /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
  if (!plan.tables.length) {
    return <EmptyState title="No tables yet" description="Each table you add to the floor plan gets its own QR code." action={<ButtonLink to="/tables?tab=plan">Draw floor plan</ButtonLink>} />;
  }
  const replace = async (id: number) => {
    if (confirm !== id) return setConfirm(id);
    setConfirm(null);
    try {
      onChange(await floorPlanApi.newQr(id));
      toast('success', 'New QR code ready. Print it: the old one no longer works.');
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Could not replace the QR code');
    }
  };
  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center gap-3">
        <p className="mr-auto max-w-xl text-[13.5px] text-ink-2">
          Stick each code on its table. Guests scan it, pick from your products and the order goes straight to the kitchen screen, marked with the table.
        </p>
        <Button variant="secondary" onClick={() => window.print()}>
          <Printer size={15} /> Print all
        </Button>
      </div>
      {localOnly && (
        <div className="no-print">
          <Alert tone="info">You're running locally, so these codes only open on this computer. Print them after the app is deployed.</Alert>
        </div>
      )}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4 print:grid-cols-3">
        {plan.tables.map((t) => (
          <div key={t.id} className="break-inside-avoid">
            <QrCard shopName={shop?.name ?? ''} logoKey={shop?.logoKey ?? null} label={t.label} token={t.qrToken} />
            {user?.role === 'owner' && (
              <button type="button" onClick={() => replace(t.id)} className="no-print mt-1 w-full text-center text-[11.5px] text-ink-3 hover:text-danger-text">
                {confirm === t.id ? 'Click again: the printed code will stop working' : 'Replace QR code'}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function TablesPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'live';
  const [plan, setPlan] = useState<FloorPlan | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const isOwner = user?.role === 'owner';

  const loadPlan = useCallback(() => {
    setError(null);
    floorPlanApi.get().then(setPlan, setError);
  }, []);
  // Loaded once for the editor and QR tabs; the live tab polls its own copy.
  useEffect(loadPlan, [loadPlan]);

  return (
    <>
      <PageTop
        tabs={[
          { key: 'live', label: 'Live tables' },
          { key: 'plan', label: 'Floor plan' },
          { key: 'qr', label: 'QR codes' },
        ]}
        value={tab}
        onChange={(k) => setParams(k === 'live' ? {} : { tab: k }, { replace: true })}
        actions={
          <ButtonLink to="/kitchen" variant="secondary">
            <ChefHat size={15} /> Kitchen screen
          </ButtonLink>
        }
      />
      <div className="px-4 py-5 sm:px-6">
        {tab === 'live' ? (
          <LiveFloor />
        ) : error ? (
          <ErrorState error={error} onRetry={loadPlan} />
        ) : !plan ? (
          <LoadingState />
        ) : tab === 'plan' ? (
          isOwner ? (
            <FloorPlanEditor plan={plan} onSaved={setPlan} />
          ) : plan.tables.length || plan.decor.length ? (
            <div className="space-y-3">
              <Alert tone="info">Only an owner can change the floor plan.</Alert>
              <FloorCanvas width={plan.width} height={plan.height} decor={plan.decor} tables={plan.tables} />
            </div>
          ) : (
            <EmptyState title="No floor plan yet" description="Ask an owner of this branch to draw it." />
          )
        ) : (
          <QrSheet plan={plan} onChange={setPlan} />
        )}
      </div>
    </>
  );
}
