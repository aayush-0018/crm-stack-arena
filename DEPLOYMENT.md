# Deployment Plan — Render + Vercel + Supabase

Moving the CRM from "runs only on this Mac" to a public URL, on free tiers.

| Piece | Where | Plan |
|---|---|---|
| Frontend (React + Vite) | **Vercel** | Free (Hobby) |
| Backend API (Express) | **Render** | Free web service |
| Database (Postgres) | **Supabase** | Free |

Repo: **`github.com/aayush-0018/crm-stack-arena`** (branch `main`) — both Render and Vercel deploy from it.

The app currently refuses to run anywhere but localhost — that was deliberate. Phase 2 below makes that a setting instead of a hard rule, so local development keeps working exactly as it does today.

### Why Supabase and not Render's own Postgres

Render does offer a managed Postgres, and putting it beside the API would be simpler. But **Render's free database is deleted after 30 days.** Per their docs it expires 30 days after creation, then gives a 14-day grace period to move to a paid plan, after which the database and all its data are removed. You also get one free database per account.

So Render Postgres means either losing everything in a month, or paying ~$6–7/month. Supabase free has no expiry — its only idle behaviour is pausing after a week, which a click resumes. That's the whole reason the database sits at a different provider.

---

## Know this before starting

**Free-tier behaviour you cannot configure away:**

- **Render sleeps after 15 minutes idle.** The first request after a quiet period takes **~50–60 seconds** while the service wakes. Every visitor after that is fast until it goes idle again. This makes it fine for demos, and painful for billing a real customer at a counter.
- **Render free gives 5 GB bandwidth/month** (cut from 100 GB in April 2026) and 750 instance-hours/month.
- **Supabase pauses a free project after 1 week with no activity.** You resume it from their dashboard.
- **Supabase free gives 500 MB** of database and 2 active projects. Our 100-customer test dataset is a few MB, so this is not a constraint.

**Combined cold start:** Render waking (~60s) *plus* Supabase waking (~1s) on the first hit of the day.

---

## Prerequisites

- [x] **GitHub repository** — `aayush-0018/crm-stack-arena`, branch `main`, 123 files pushed.
- [x] **`backend/.env` is not committed.** Verified: it's untracked, so your local JWT secret stays off GitHub. Keep it that way — every secret goes in the Render dashboard, never in the repo.
- [ ] Render account, Vercel account, Supabase account. All three sign up free with GitHub, no card.
- [x] `psql` on your Mac.

Push any further changes before deploying — Render and Vercel build from what's on `main`, not from your working copy.

---

## Phase 1 — Supabase (database first)

Everything else needs the connection string, so this goes first.

- [ ] Create a project at supabase.com. Pick the **region closest to India** (Mumbai or Singapore) — this is the single biggest factor in how fast the app feels.
- [ ] Set a strong database password and save it; it becomes part of the connection string.
- [ ] Click **Connect** in the dashboard and copy the **Session mode** string. It looks like:

```
postgresql://postgres.<PROJECT-REF>:<PASSWORD>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

**Take the session-mode pooler string specifically (port 5432, username starting `postgres.`).** Two wrong turns to avoid:
- The **direct** connection is IPv6-only on the free plan and will likely just fail to connect from your Mac.
- **Transaction mode** is port `6543`. Our code would mostly work on it, but Supabase recommends session mode for outside applications like ours, and it's the safer choice for our `BEGIN`/`COMMIT` transactions and `SELECT … FOR UPDATE` row locks.

### Create the tables

From your Mac, pointing the existing migration runner at Supabase:

```bash
cd backend
DATABASE_URL="<session-mode-string>" ALLOW_REMOTE_DB=true DATABASE_SSL=true npm run migrate
```

(That works once Phase 2 is done. Alternatively, run the SQL directly — no code changes needed:)

```bash
psql "<session-mode-string>" -f db/migrations/001_init.sql
```

- [ ] Verify with `psql "<string>" -c "\dt"` — expect 8 tables.

### Close the Data API hole — do not skip this

Supabase publishes tables in the `public` schema through its REST API, reachable with the project's **anon key, which is designed to be public**. Our app never uses that layer — it connects straight to Postgres and does its own JWT auth — but the tables would sit there exposed to anyone with that key.

Pick one:
- **Project Settings → API → turn the Data API off** for the `public` schema (simplest, and we don't use it), **or**
- Enable Row Level Security on all 8 tables with no policies. Our server connects as the `postgres` role, which bypasses RLS, so the app keeps working.

- [ ] Confirm the dashboard shows no "RLS disabled on public tables" warning.

### Which data?

- **Start clean (recommended):** run the migration only. You then register the shop through the app's own sign-up page.
- **Copy the local data across** (keeps Vardhman, the 100 test customers, 388 orders, 320 invoices):

```bash
pg_dump --no-owner --no-acl postgres://crm:crm@localhost:5432/crm_dev > /tmp/crm.sql
psql "<session-mode-string>" -f /tmp/crm.sql     # instead of running the migration
```

Note this copies the **seeded test data** too. If this is a demo, that's a plus. If it's a real shop, start clean.

---

## Phase 2 — Code changes

Four small edits. None of them change how the app behaves locally.

### 2.1 `backend/src/config/env.ts` — make the local-only rule a setting

The hard localhost check becomes an opt-out, so you can't point production at a remote database by accident.

```ts
const isLocal = (u: string) => {
  const host = new URL(u).hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
};

const envSchema = z
  .object({
    PORT: z.coerce.number().int().positive().default(4000),
    HOST: z.string().default('127.0.0.1'),
    DATABASE_URL: z.string().url(),
    DATABASE_SSL: z.enum(['true', 'false']).default('false'),
    ALLOW_REMOTE_DB: z.enum(['true', 'false']).default('false'),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    JWT_EXPIRES_IN: z.string().default('7d'),
    CORS_ORIGIN: z.string().default('http://localhost:5173'),
  })
  .refine((e) => e.ALLOW_REMOTE_DB === 'true' || isLocal(e.DATABASE_URL), {
    message: 'DATABASE_URL is not local. Set ALLOW_REMOTE_DB=true to allow a hosted database.',
    path: ['DATABASE_URL'],
  });
```

### 2.2 `backend/src/db/pool.ts` — SSL and a smaller pool

Supabase requires TLS.

```ts
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  max: 5, // Render free is small; no need for 10 connections
});
```

`rejectUnauthorized: false` encrypts the connection but skips verifying Supabase's certificate. That is what most guides use and is acceptable here. To verify properly, download Supabase's CA certificate from the dashboard and pass it as `ssl: { ca }`.

### 2.3 `backend/src/app.ts` — allow more than one origin

Vercel gives every preview deployment its own URL, so a single fixed origin is limiting.

```ts
const origins = env.CORS_ORIGIN.split(',').map((o) => o.trim());
app.use(cors({ origin: origins }));
```

### 2.4 `frontend/src/api/client.ts` — point at the API

`buildUrl` currently returns a relative `/api/...`, which only works because the Vite dev server proxies it. On Vercel there is no proxy.

```ts
const API_BASE = import.meta.env.VITE_API_URL ?? '';

function buildUrl(path: string, query?: Query) {
  // ...unchanged...
  return `${API_BASE}/api${path}${s ? `?${s}` : ''}`;
}
```

Leaving `VITE_API_URL` unset keeps local development on the proxy, exactly as now.

### 2.5 `frontend/vercel.json` — new file, for client-side routing

Without this, loading `https://yourapp.vercel.app/customers/24` directly returns a 404, because no such file exists. Vercel checks for a real file first, so assets are unaffected.

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

- [ ] `cd backend && npm run build` and `cd frontend && npm run build` both pass
- [ ] App still works locally against the local database
- [ ] Commit and push

---

## Phase 3 — Render (backend)

**New → Web Service → connect the GitHub repo.**

| Setting | Value |
|---|---|
| Name | `shop-crm-api` |
| Root Directory | `backend` |
| Runtime | Node |
| Build Command | `npm ci && npm run build` |
| Start Command | `npm start` |
| Health Check Path | `/api/health` |
| Instance Type | Free |

### Environment variables

| Key | Value |
|---|---|
| `NODE_VERSION` | `20` |
| `HOST` | `0.0.0.0` ← **required**; the default `127.0.0.1` makes Render unreachable |
| `DATABASE_URL` | the Supabase session-mode string |
| `DATABASE_SSL` | `true` |
| `ALLOW_REMOTE_DB` | `true` |
| `JWT_SECRET` | **a new one** — see below |
| `JWT_EXPIRES_IN` | `7d` |
| `CORS_ORIGIN` | `http://localhost:5173` for now; updated in Phase 5 |

Do not reuse the local secret. Generate a fresh one:

```bash
openssl rand -hex 32
```

**Do not set `PORT`** — Render provides it, and our `env.ts` already reads it.

- [ ] Deploy, then check `https://shop-crm-api.onrender.com/api/health` returns `{"ok":true}` (first load takes ~60s)
- [ ] Note the service URL

---

## Phase 4 — Vercel (frontend)

**Add New → Project → import the same repo.**

| Setting | Value |
|---|---|
| Root Directory | `frontend` |
| Framework Preset | Vite |
| Build Command | `npm run build` (default) |
| Output Directory | `dist` (default) |

### Environment variable

| Key | Value |
|---|---|
| `VITE_API_URL` | `https://shop-crm-api.onrender.com` (no trailing slash) |

**Vite bakes `VITE_*` variables in at build time.** Changing this later requires a redeploy, not just a restart.

- [ ] Deploy and note the URL, e.g. `https://shop-crm.vercel.app`

---

## Phase 5 — Connect the two

- [ ] In Render, set `CORS_ORIGIN` to the Vercel URL. To keep local development working against production too, use a comma-separated list:

```
https://shop-crm.vercel.app,http://localhost:5173
```

- [ ] Render redeploys on save. Wait for it to finish.

---

## Phase 6 — Verify

Work through the real flow, not just the home page.

- [ ] Open the Vercel URL. First load is slow (Render waking) — expected.
- [ ] **Register** a shop, or log in if you copied the local data.
- [ ] **Settings** → fill in shop name, address, phone. These print on invoices.
- [ ] **Add a customer**, then search for them.
- [ ] **New order** with 2–3 items; check the total is right.
- [ ] **Generate invoice** → **Download PDF**. Confirm the amounts match the order and the rows aren't squeezed.
- [ ] **Edit the order**, then confirm the "needs reissue" warning appears and reissuing creates Rev 2.
- [ ] Reload a deep link like `/customers/1` directly — confirms `vercel.json` works.
- [ ] Open the browser console and confirm there are **no CORS errors**.
- [ ] Open it on your phone.

---

## Known issues you'll hit

| Symptom | Cause | Fix |
|---|---|---|
| First load takes a minute | Render spin-up | Expected on free. Nothing to fix. |
| "Cannot reach the server" after a week | Supabase project paused | Resume it in the Supabase dashboard. |
| CORS error in console | `CORS_ORIGIN` doesn't match the Vercel URL exactly | Match scheme and host exactly, no trailing slash. |
| API calls go to the Vercel domain | `VITE_API_URL` missing at build time | Set it in Vercel, then **redeploy**. |
| 404 on a deep link | `vercel.json` missing | Add it (step 2.5). |
| Render deploy succeeds but the service is unreachable | `HOST` still `127.0.0.1` | Set `HOST=0.0.0.0`. |
| `ENETUNREACH` / connection timeout to Supabase | Used the direct (IPv6) string | Use the session-mode pooler string. |
| `no pg_hba.conf entry … no encryption` | SSL off | Set `DATABASE_SSL=true`. |

---

## Schema updates after the first deploy

Render never runs migrations — it only builds and starts the API. When a new file lands in `backend/db/migrations/`, run it against Supabase from your Mac **before** pushing the code that depends on it:

```bash
cd backend
DATABASE_URL="<session-pooler-string>" ALLOW_REMOTE_DB=true DATABASE_SSL=true npm run migrate
```

The runner skips files already applied, so it's safe to run any time.

| Migration | Adds | Needed by |
|---|---|---|
| `001_init.sql` | All core tables | Everything |
| `002_invoice_sharing.sql` | `invoices.share_token` column, `invoice_shares` table | "Send invoice" — without it, sending fails with a 500 |
| `003_branches.sql` | `shop_members` table (backfilled from existing users), `shops.code` | Branches — **without it, nobody can log in** |
| `004_last_branch_set_null.sql` | Deleting a branch no longer deletes users whose last-opened branch it was | Safety fix for 003 — run together |
| `005_logos_and_password_reset.sql` | `shop_logos` table, `shops.logo_key`, `password_resets` table, `users.password_changed_at` | Logos and forgot password — **without it, nobody can log in** (the shop now includes its logo). Run before pushing. See [MAIL_SETUP.md](MAIL_SETUP.md) |
| `006_complete_settled_orders.sql` | Data only: open orders that are fully paid and invoiced become Completed | Safe before or after the push |
| `007_payments.sql` | `payments` table (payment ledger), plus one "opening" entry for every order that already has money paid. No existing value changes | Payments, refunds, analytics — **run before pushing**: order pages and analytics read this table |
| `008_zero_total_orders.sql` | ₹0 orders count as Paid (data repair + updated `orders_payment_ck` rule) | Run with 007 |
| `009_products_inventory.sql` | `products`, `stock_movements`, `order_items.product_id`, `shops.allow_negative_stock` | Products & stock — **run before pushing**: login returns the shop's stock setting |
| `010_walk_in_orders.sql` | `orders.customer_id` may be empty (walk-in sales). Existing orders unchanged | Walk-in sales — run before pushing that code |
| `011_receipts.sql` | `receipts` table, `payments.receipt_id`, receipt and refund counters | Receipts — **run before deploying**: every new payment writes a receipt, so recording payments fails without it |
| `012_returns.sql` | `order_returns`, `order_return_items`, `orders.returned_paise` (total rule now `subtotal − discount − returned`), `payments.return_id`, the `return` stock movement | Returns — **run before deploying**: every order page reads returns |
| `013_catalogues.sql` | `catalogues` table (one per branch: link token, design, title, tagline, options) | Product catalogue — run before deploying: the Catalogue button and `/c/…` links read it. Nothing else depends on it |
| `014_dine_in.sql` | `floor_plans`, `dining_tables`; on `orders`: `source`, `table_id`, `table_label`, `guest_name`, `kitchen_status`, `kitchen_updated_at`, `guest_token` | Tables, QR ordering and kitchen screen — **run before deploying**: the order list and order pages read the new columns |

**Run 003 and 004 together, before pushing the branches code.** Login now reads `shop_members`; if the code goes live first, every login fails until the migration runs. To apply only these two:

```bash
psql "$SUPA" -v ON_ERROR_STOP=1 -1 -f db/migrations/003_branches.sql
psql "$SUPA" -v ON_ERROR_STOP=1 -1 -f db/migrations/004_last_branch_set_null.sql
```

**Each new table also needs the Data API protection from Phase 1.** If you chose RLS rather than switching the Data API off, enable it on `invoice_shares`, `shop_members`, `shop_logos`, `password_resets`, `payments`, `products`, `stock_movements`, `receipts`, `order_returns`, `order_return_items`, `catalogues`, `floor_plans` and `dining_tables` too.

**011–012 (receipts, returns):** additive; existing rows keep their values (`returned_paise` starts at 0). Rehearsed by the upgrade test in `migrations.test.ts`. Rollback: redeploy the previous code; don't drop the tables (they hold receipt and return history).

**013 (catalogues):** additive, a new table only. Rollback: redeploy the previous code; links already sent simply stop opening.

**014 (dine-in):** additive; existing orders get `source = 'staff'` and nulls. Rollback: redeploy the previous code (it ignores the new columns); keep the tables, since table orders point at them.

**"Needs reissue" check (read-only):** `DATABASE_URL="<session-pooler-string>" ALLOW_REMOTE_DB=true DATABASE_SSL=true npm run check-reissue` lists invoices flagged only by old payments vs. ones with a real change. It changes nothing.

**007–009 (payments, ₹0 orders, products):** run all three before pushing that code. Each file runs in one transaction, so a failure changes nothing. They were rehearsed on a copy of the local data (390 orders, 320 invoices): orders and invoices came out unchanged, and the ledger matched every order's paid amount.

```bash
cd backend
DATABASE_URL="<session-pooler-string>" ALLOW_REMOTE_DB=true DATABASE_SSL=true npm run migrate
```

Rollback: the code before these changes ignores the new tables and column, so rolling back the deploy is enough. Don't drop the tables: they hold payment and stock history.

### Invoice links in production

"Send invoice" gives each invoice a private link of the form:

```
https://crm-stack-arena.onrender.com/api/public/invoices/<random-token>/pdf
```

- The link opens that **one** invoice's PDF without a login. The 24-character random token is the permission; it can't be guessed and unlocks nothing else.
- It's served by Render, so a customer opening it on a cold morning waits for the ~60s wake-up like everyone else.
- Locally the link points at `localhost`, which only works on your own computer — the send dialog warns about this.

---

## What this costs

₹0/month. No credit card is needed for any of the three.

The limit you'd hit first is **Render's 5 GB/month bandwidth**. Our frontend is served by Vercel, so Render only sends JSON and PDFs — thousands of page views a month would fit comfortably.

---

## Before a real shop uses this

This setup is right for a demo or for showing people the app. Three things change if actual customers' data goes in:

1. **The cold start is unacceptable at a counter.** A shopkeeper will not wait 60 seconds to print a bill. Upgrade Render to its paid tier (~$7/month) or move to the Hostinger VPS plan we discussed.
2. **Free tiers promise nothing about your data.** Supabase free has no backup guarantee worth relying on. Schedule a `pg_dump` somewhere you control.
3. **Real customer phone numbers become your legal responsibility** under India's DPDP Act, 2023 — storage, consent for any messaging, and deletion on request. The notes in [GROWTH_IDEAS.md](GROWTH_IDEAS.md) cover the messaging side.

---

## Keeping local development working

Nothing above breaks the current setup. With `backend/.env` untouched, `ALLOW_REMOTE_DB` and `DATABASE_SSL` both default to `false`, `VITE_API_URL` is unset, and the app runs against local Postgres exactly as it does today:

```bash
cd backend && npm run dev      # 127.0.0.1:4000, local database
cd frontend && npm run dev     # localhost:5173, proxying /api
```

To point your local app at the Supabase database instead, add to `backend/.env`:

```
DATABASE_URL=<session-mode-string>
ALLOW_REMOTE_DB=true
DATABASE_SSL=true
```
