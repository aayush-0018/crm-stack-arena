const MONEY_RE = /^\d{1,10}(\.\d{1,2})?$/;
const QTY_RE = /^\d{1,5}(\.\d{1,3})?$/;

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });

export const formatINR = (paise: number) => inr.format(paise / 100);

/** 12550 -> "125.50" (for prefilling inputs) */
export const paiseToInput = (paise: number) => (paise / 100).toFixed(2);

export const isValidMoney = (v: string) => MONEY_RE.test(v.trim());
export const isValidQty = (v: string) => QTY_RE.test(v.trim()) && qtyToMilli(v) > 0;

/** "125.5" -> 12550, or null if invalid */
export function moneyToPaise(v: string): number | null {
  const s = v.trim();
  if (!MONEY_RE.test(s)) return null;
  const [r, p = ''] = s.split('.');
  return Number(r) * 100 + Number((p + '00').slice(0, 2));
}

export function qtyToMilli(v: string): number {
  const s = v.trim();
  if (!QTY_RE.test(s)) return 0;
  const [i, f = ''] = s.split('.');
  return Number(i) * 1000 + Number((f + '000').slice(0, 3));
}

/** Same integer math as the server; used only for the live preview. */
export function lineTotalPaise(qty: string, price: string): number {
  const m = qtyToMilli(qty);
  const p = moneyToPaise(price) ?? 0;
  return Number((BigInt(m) * BigInt(p) + 500n) / 1000n);
}

/** "2.500" -> "2.5" */
export const formatQty = (q: string) => String(Number(q));

/** Compact Indian format for axes and tiles: ₹950, ₹12.5K, ₹3.4L, ₹1.2Cr */
export function formatINRCompact(paise: number): string {
  const r = paise / 100;
  const fmt = (n: number) => (n >= 100 ? Math.round(n).toString() : n.toFixed(1).replace(/\.0$/, ''));
  if (r >= 1e7) return `₹${fmt(r / 1e7)}Cr`;
  if (r >= 1e5) return `₹${fmt(r / 1e5)}L`;
  if (r >= 1e3) return `₹${fmt(r / 1e3)}K`;
  return `₹${Math.round(r)}`;
}
