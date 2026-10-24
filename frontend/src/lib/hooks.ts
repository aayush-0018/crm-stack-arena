import { DependencyList, useCallback, useEffect, useState } from 'react';

interface AsyncState<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
}

/** Runs an async loader on mount / when deps change. Exposes reload() and setData(). */
export function useAsync<T>(fn: () => Promise<T>, deps: DependencyList) {
  const [state, setState] = useState<AsyncState<T>>({ data: undefined, error: undefined, loading: true });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    fn().then(
      (data) => !cancelled && setState({ data, error: undefined, loading: false }),
      (error: Error) => !cancelled && setState((s) => ({ ...s, error, loading: false })),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const setData = useCallback((data: T) => setState({ data, error: undefined, loading: false }), []);
  return { ...state, reload, setData };
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
