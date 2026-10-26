import { useCallback, useEffect, useState } from 'react';
import { dashboardApi } from '../api/endpoints';
import { useToast } from '../context/ToastContext';
import type { DailySummary } from '../types';

/**
 * The daily summary unlocks at 10 pm India time and is kept only in this browser
 * (localStorage, one per branch). At the next 10 pm it's replaced by the new one.
 * Nothing about it is stored on the server — the numbers are computed on request.
 */
const IST_OFFSET = 330 * 60_000; // India has no daylight saving, so a fixed offset is exact
const DAY = 86_400_000;
const CUTOFF_HOUR = 22;

const istDate = (ms: number) => new Date(ms + IST_OFFSET).toISOString().slice(0, 10);

/** The most recent summary date that has unlocked: today after 10 pm, otherwise yesterday. */
export function latestSummaryDate(now = Date.now()) {
  const hour = new Date(now + IST_OFFSET).getUTCHours();
  return hour >= CUTOFF_HOUR ? istDate(now) : istDate(now - DAY);
}

/** Milliseconds until the next 10 pm in India. */
export function msUntilNextCutoff(now = Date.now()) {
  const ist = now + IST_OFFSET;
  let target = Math.floor(ist / DAY) * DAY + CUTOFF_HOUR * 3_600_000;
  if (ist >= target) target += DAY;
  return target - ist;
}

interface Stored {
  date: string;
  data: DailySummary;
  seen: boolean;
}

const key = (shopId: number) => `crm.dailySummary.v1.${shopId}`;
const read = (shopId: number): Stored | null => {
  try {
    const raw = localStorage.getItem(key(shopId));
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch {
    return null;
  }
};
const write = (shopId: number, s: Stored) => {
  try {
    localStorage.setItem(key(shopId), JSON.stringify(s));
  } catch {
    /* storage unavailable: lasts until reload */
  }
};

export function useDailySummary(shopId: number | undefined) {
  const toast = useToast();
  const [stored, setStored] = useState<Stored | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Loads the latest unlocked summary, from this browser if we already have it. */
  const refresh = useCallback(
    async (announce = false) => {
      if (!shopId) return;
      const date = latestSummaryDate();
      const have = read(shopId);
      if (have?.date === date) {
        setStored(have);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const next: Stored = { date, data: await dashboardApi.dailySummary(date), seen: false };
        write(shopId, next); // replaces the previous day's summary
        setStored(next);
        if (announce) toast('info', "Today's summary is ready — tap the bell to see it");
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load the summary');
      } finally {
        setLoading(false);
      }
    },
    [shopId, toast],
  );

  useEffect(() => {
    setStored(shopId ? read(shopId) : null);
    refresh();
  }, [shopId, refresh]);

  // Wake up at 10 pm. Also re-check when the tab comes back, since timers in
  // background tabs and sleeping laptops can fire late.
  useEffect(() => {
    let timer: number;
    const schedule = () => {
      timer = window.setTimeout(async () => {
        await refresh(true);
        schedule();
      }, msUntilNextCutoff() + 1_000);
    };
    schedule();
    const onVisible = () => document.visibilityState === 'visible' && refresh(true);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  const markSeen = useCallback(() => {
    if (!shopId || !stored || stored.seen) return;
    const next = { ...stored, seen: true };
    write(shopId, next);
    setStored(next);
  }, [shopId, stored]);

  return {
    summary: stored?.data ?? null,
    unread: !!stored && !stored.seen,
    loading,
    error,
    markSeen,
    retry: () => refresh(),
  };
}
