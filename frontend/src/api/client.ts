const TOKEN_KEY = 'crm_token';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }

  /** Field-level messages (string values only). */
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(this.details ?? {})) if (typeof v === 'string') out[k] = v;
    return out;
  }
}

export const tokenStore = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string) {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* storage unavailable: session lasts until reload */
    }
  },
  clear() {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  },
};

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: (() => void) | null) => {
  onUnauthorized = fn;
};

type Query = Record<string, string | number | undefined | null>;

// Empty in development, where Vite proxies /api to the local backend.
// In production this is the deployed API's origin, set via VITE_API_URL at build time.
const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

/** Origin that serves /api — the deployed API in production, this site in development. */
export const apiOrigin = () => API_BASE || window.location.origin;

function buildUrl(path: string, query?: Query) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const s = qs.toString();
  return `${API_BASE}/api${path}${s ? `?${s}` : ''}`;
}

async function send(method: string, path: string, opts: { body?: unknown; query?: Query; headers?: Record<string, string> } = {}) {
  const token = tokenStore.get();
  const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Check that the backend is running and try again.');
  }

  if (!res.ok) {
    let payload: { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | null = null;
    try {
      payload = await res.json();
    } catch {
      /* non-JSON error */
    }
    const e = payload?.error;
    const err = new ApiError(res.status, e?.code ?? `HTTP_${res.status}`, e?.message ?? 'Request failed', e?.details);
    if (err.code === 'UNAUTHENTICATED') {
      tokenStore.clear();
      onUnauthorized?.();
    }
    throw err;
  }
  return res;
}

async function json<T>(method: string, path: string, opts?: { body?: unknown; query?: Query; headers?: Record<string, string> }): Promise<T> {
  const res = await send(method, path, opts);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  /** Same calls with extra request headers (e.g. a guest's session on public pages). */
  with: (headers: Record<string, string>) => ({
    get: <T>(path: string) => json<T>('GET', path, { headers }),
    post: <T>(path: string, body?: unknown) => json<T>('POST', path, { body: body ?? {}, headers }),
  }),
  get: <T>(path: string, query?: Query) => json<T>('GET', path, { query }),
  post: <T>(path: string, body?: unknown, query?: Query) => json<T>('POST', path, { body: body ?? {}, query }),
  put: <T>(path: string, body: unknown) => json<T>('PUT', path, { body }),
  patch: <T>(path: string, body: unknown) => json<T>('PATCH', path, { body }),
  delete: <T>(path: string) => json<T>('DELETE', path),
  blob: async (path: string) => (await send('GET', path)).blob(),
};
