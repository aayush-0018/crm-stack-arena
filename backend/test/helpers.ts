/**
 * Integration-test harness: runs the real Express app against a disposable local database.
 * Uses only Node built-ins (node:test, fetch) — no test dependencies.
 *
 * Safety: refuses to run unless TEST_DATABASE_URL points at a *local* database whose name ends
 * in `_test`, because every test file wipes and rebuilds that database from the migrations.
 */
import fs from 'fs';
import type { AddressInfo } from 'net';
import path from 'path';
import type { Server } from 'http';

const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgres://crm@localhost:5432/crm_test';
const u = new URL(TEST_DB);
if (!['localhost', '127.0.0.1', '::1'].includes(u.hostname) || !/_test$/.test(u.pathname.slice(1))) {
  throw new Error(`Refusing to run tests against ${u.hostname}${u.pathname}: use a local *_test database`);
}
// Must be set before src/config/env is first imported (dotenv never overrides set variables).
process.env.DATABASE_URL = TEST_DB;
process.env.ALLOW_REMOTE_DB = 'false';
process.env.DATABASE_SSL = 'false';
process.env.MAIL_PROVIDER = 'console';
process.env.JWT_SECRET ??= 'test-secret-test-secret-test-secret-123';

let server: Server | null = null;
let base = '';

const MIGRATIONS = path.join(__dirname, '..', 'db', 'migrations');
export const migrationFiles = () => fs.readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort();

/** Wipes the test database, then applies migrations in order — all of them, or only those in `files`. */
export async function resetDb(files = migrationFiles()) {
  const { pool } = await import('../src/db/pool');
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  for (const f of files) await applyMigration(f);
}

export async function applyMigration(file: string) {
  const { pool } = await import('../src/db/pool');
  await pool.query(fs.readFileSync(path.join(MIGRATIONS, file), 'utf8'));
}

/** Wipes the test database, applies every migration, and starts the API on a random port. */
export async function start() {
  await resetDb();
  const { app } = await import('../src/app');
  const log = console.log;
  console.log = () => undefined; // keep console-mailer output out of test results
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server!.once('listening', r));
  console.log = log;
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
}

/** The running API's base URL, for requests that need custom headers. */
export const apiBase = () => base;

export async function stop() {
  await new Promise((r) => server?.close(r));
  const { pool } = await import('../src/db/pool');
  await pool.end();
}

export async function sql<T = any>(text: string, values?: unknown[]): Promise<T[]> {
  const { pool } = await import('../src/db/pool');
  return (await pool.query(text, values)).rows;
}

export interface Res<T = any> {
  status: number;
  body: T;
}

export function client(token?: string) {
  const call = async <T = any>(method: string, p: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res<T>> => {
    const r = await fetch(`${base}${p}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let parsed: any = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* non-JSON (PDF) */
    }
    return { status: r.status, body: parsed };
  };
  return {
    get: <T = any>(p: string) => call<T>('GET', p),
    post: <T = any>(p: string, b?: unknown, h?: Record<string, string>) => call<T>('POST', p, b, h),
    put: <T = any>(p: string, b?: unknown) => call<T>('PUT', p, b),
    patch: <T = any>(p: string, b?: unknown) => call<T>('PATCH', p, b),
    del: <T = any>(p: string) => call<T>('DELETE', p),
  };
}
export type Client = ReturnType<typeof client>;

let n = 0;
/** Registers a fresh synthetic shop + owner and returns an authenticated client. */
export async function newShop(name = 'Test Shop') {
  n += 1;
  const email = `owner${n}-${Date.now()}@example.test`;
  const r = await client().post('/auth/register', { shopName: `${name} ${n}`, name: 'Owner', email, password: 'password123' });
  if (r.status !== 201) throw new Error(`register failed: ${r.status} ${JSON.stringify(r.body)}`);
  return { api: client(r.body.token), token: r.body.token as string, shopId: r.body.shop.id as number, email };
}

let phone = 9000000000;
export const nextPhone = () => String((phone += 1));

/** Creates an order for a new customer. Amounts are rupee strings, as the UI sends them. */
export async function newOrder(
  api: Client,
  opts: { items?: { itemName: string; quantity: string; unitPrice: string }[]; discount?: string; amountPaid?: string; customerId?: number; orderDate?: string } = {},
) {
  const body: Record<string, unknown> = {
    items: opts.items ?? [{ itemName: 'Rice', quantity: '2', unitPrice: '50' }],
    discount: opts.discount ?? '0',
    amountPaid: opts.amountPaid ?? '0',
    orderDate: opts.orderDate,
  };
  if (opts.customerId) body.customerId = opts.customerId;
  else body.newCustomer = { name: 'Cust', phone: nextPhone() };
  const r = await api.post('/orders', body);
  if (r.status !== 201) throw new Error(`order failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}
