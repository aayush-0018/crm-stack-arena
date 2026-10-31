import { useEffect, useRef, useState } from 'react';
import type { KitchenOrder, KitchenStatus } from '../../types';

export const KITCHEN_LABEL: Record<KitchenStatus, string> = { new: 'New', preparing: 'Preparing', ready: 'Ready', served: 'Served' };
export const NEXT_STATUS: Partial<Record<KitchenStatus, KitchenStatus>> = { new: 'preparing', preparing: 'ready', ready: 'served' };
export const PREV_STATUS: Partial<Record<KitchenStatus, KitchenStatus>> = { preparing: 'new', ready: 'preparing', served: 'ready' };

/** "2.000" -> "2" */
export const qty = (q: string | number) => String(Number(q));

/** Minutes since an ISO time, as "Just now" / "4 min" / "1 h 12 min". */
export function since(iso: string, now = Date.now()) {
  const min = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  if (min < 1) return 'Just now';
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}

export const minutesSince = (iso: string, now = Date.now()) => (now - new Date(iso).getTime()) / 60_000;

/** Where a table stands, from its unfinished orders (or a booking, when it has none). Most urgent first. */
export type TableState = 'free' | 'ready' | 'new' | 'preparing' | 'unpaid' | 'reserved';
export function tableState(orders: KitchenOrder[]): TableState {
  if (!orders.length) return 'free';
  if (orders.some((o) => o.kitchenStatus === 'ready')) return 'ready';
  if (orders.some((o) => o.kitchenStatus === 'new')) return 'new';
  if (orders.some((o) => o.kitchenStatus === 'preparing')) return 'preparing';
  return 'unpaid';
}

export const TABLE_STATE: Record<TableState, { label: string; tone: string; dot: string }> = {
  free: { label: 'Free', tone: 'border-line-strong bg-surface text-ink', dot: 'bg-ink-4' },
  new: { label: 'New order', tone: 'border-warn-line bg-warn-bg-2 text-warn-strong', dot: 'bg-warn-strong' },
  preparing: { label: 'Preparing', tone: 'border-info-line bg-info-bg-2 text-info-strong', dot: 'bg-info-strong' },
  ready: { label: 'Ready to serve', tone: 'border-success-line bg-success-bg-2 text-success-strong animate-pulse', dot: 'bg-success-strong' },
  unpaid: { label: 'Awaiting payment', tone: 'border-danger-line-2 bg-danger-bg-2 text-danger-text', dot: 'bg-danger' },
  reserved: { label: 'Reserved', tone: 'border-dashed border-ink-3 bg-wash text-ink', dot: 'bg-ink-3' },
};

/** Calls `fn` now and every `ms` while the tab is visible (and right away when it becomes visible again). */
export function usePolling(fn: () => void, ms: number) {
  const saved = useRef(fn);
  saved.current = fn;
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const startTimer = () => {
      if (timer) clearInterval(timer);
      timer = setInterval(() => document.visibilityState === 'visible' && saved.current(), ms);
    };
    const onVisible = () => document.visibilityState === 'visible' && saved.current();
    saved.current();
    startTimer();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [ms]);
}

/** Re-renders every `ms` so "x min ago" labels stay current. */
export function useNow(ms = 15_000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Link printed on a table's QR code. */
export const tableUrl = (qrToken: string) => `${window.location.origin}/t/${qrToken}`;
