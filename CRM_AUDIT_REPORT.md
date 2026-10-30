# CartWell CRM — Audit Report (Checkpoint 0) and Plan (Checkpoint 1)

Audit baseline: commit `a0d811f` on `main`, clean working tree, 30 Oct 2026.
Scope: whole repository, with the review checklists `03`–`10` used as the audit checklist.
Data checks ran **read-only** against the local development database (`crm_dev`: 1 shop, 101 customers, 390 orders, 320 invoices).

---

## 1. Architecture summary

| Area | What the repository actually uses |
|---|---|
| Frontend | React 18 + Vite 5 + TypeScript, Tailwind CSS, React Router 6, Zod. Deployed on Vercel (`frontend/vercel.json`). |
| Backend | Node 20 + Express 4 + TypeScript (`tsc` build, `tsx` for dev). Deployed on Render. |
| Database | PostgreSQL. Raw SQL through `pg` (no ORM). Hosted on Supabase in production. Six SQL migrations in `backend/db/migrations`, applied by `backend/scripts/migrate.ts` and tracked in `schema_migrations`. |
| Auth | Email + password (bcrypt, cost 12). JWT (7 days) carrying `shopId`. Password reset uses single-use SHA-256-hashed tokens. Tokens issued before a password change are rejected. |
| Tenancy | Each branch is a `shops` row. `shop_members` controls access. Every query is scoped by the `shopId` from the token. |
| Money | Integer paise (`BIGINT`). Quantities `NUMERIC(10,3)`. All totals are recomputed on the server (`orders/totals.ts`). |
| Documents | Invoices are immutable JSON snapshots with revisions (`issued` / `superseded` / `void`). PDFs are made by pdfmake. Public share links use a random token. |
| Email | HTTP providers (Brevo/Resend) or console output. |
| Tests / lint | **None.** There is no test runner, no test files and no ESLint config. |

## 2. Baseline commands and results (before any change)

| Command | Result |
|---|---|
| `backend: npx tsc --noEmit` | Pass (0 errors) |
| `backend: npm run build` | Pass |
| `frontend: npx tsc --noEmit` | Pass (0 errors) |
| `frontend: npm run build` | Pass (398.8 kB JS) |
| Lint | Not configured |
| Unit / integration / e2e tests | None exist |

There were no failures in the baseline.

---

## 3. Verified findings

Statuses: **Confirmed** = reproduced in code and/or data. **Needs product decision** = the code works as written, but the right behaviour is a business choice. **Not applicable** = the concern doesn't apply to this codebase. **Not reproduced**.

### P0 — correctness, security, broken core behaviour

| # | Finding | Status | Evidence | Impact |
|---|---|---|---|---|
| F1 | Login has no brute-force protection. Unlimited password guesses are possible per account and per IP. | Confirmed | `backend/src/modules/auth/auth.routes.ts` `/login`, `auth.service.ts` `login()`. Only forgot-password is throttled (`password.service.ts` `tooMany`). | Account takeover risk on a public deployment. |
| F2 | Dashboard "Oldest unpaid orders" lists **cancelled** orders and leaves out **partly paid** ones. | Confirmed | `frontend/src/pages/DashboardPage.tsx`: `ordersApi.list({ paymentStatus: 'unpaid', … })` has no status filter. Local data has 4 cancelled orders that are still "unpaid". | The owner chases money that isn't owed and misses part-payments. |
| F3 | Dashboard "Average bill value" is labelled "7d rolling", but the number shown is the 30-day average. Only the sparkline is 7-day rolling. | Confirmed | `DashboardPage.tsx`: `value = s.revenuePaise / s.orders` (30-day window), `suffix="7d rolling"`. | Wrong label on a KPI. |
| F4 | On the customer page, the "Orders" count includes cancelled orders. The customer list, segments, Total spent and Payments pending all exclude them. | Confirmed | `customers.repo.ts` `customerStats()`: `count(*)` without a status filter, vs `SEGMENT_CTE` `FILTER (WHERE o.status <> 'cancelled')`. Affects 9 customers locally. | The two pages disagree, and the customer page's "Average order" is understated. |
| F5 | There are no automated tests, so no regression safety net exists for money, invoice and tenancy rules. | Confirmed | No test files or test script. | Every change is verified by hand only. |

### P1 — financial model and daily-use gaps (several need a decision)

| # | Finding | Status | Evidence | Impact |
|---|---|---|---|---|
| F6 | Payments are a single overwritten number ("total paid so far"). There is no payment date, method (cash/UPI/card), reference, history, receipt or refund record. | Confirmed | `orders.amount_paid_paise`; `PATCH /orders/:id/payment` (`orders.service.ts` `setPayment`); UI "Total amount paid so far". | Two people recording payments can overwrite each other. Nothing shows when money came in. |
| F7 | Analytics/Dashboard "Payments received" really means *amount paid on orders dated in the window*, not *money received in the window*. | Confirmed (follows from F6) | `dashboard.routes.ts` `/analytics`: `sum(amount_paid_paise) … WHERE order_date > …`. | "Payments received · 30d" can't be checked against cash or bank records. |
| F8 | Recording a payment marks the order's issued invoice **"Needs reissue"**, even though nothing billed has changed. | Confirmed | `orders.repo.ts` `updatePayment()` does `version = version + 1`. **All 10** flagged invoices locally have unchanged totals and discount. | Spurious reissues: new invoice revisions for every part-payment. |
| F9 | A cancelled order keeps the money recorded against it. There is no refund or credit record. | Needs product decision | `setStatus('cancelled')` leaves `amount_paid_paise` untouched. Locally: 9 cancelled orders with ₹4,396.10 recorded as paid. | Money in limbo: not in sales, not refunded. |
| F10 | An order with a ₹0 total (free items or a 100% discount) can never become "Paid". It stays "Unpaid" for ever and counts as payment pending. | Confirmed | `001_init.sql` `orders_payment_ck` needs `amount_paid_paise > 0` for `paid`; `totals.ts` `derivePaymentStatus(0, 0) → 'unpaid'`. No such rows exist locally. | It inflates "Payment pending" and the order never auto-completes. |
| F11 | "Active" means two different things. The Dashboard/Customers KPI "Active customers" = bought in the last 60 days. The Customers **Active tab** = a segment that excludes New, VIP and Forgotten. | Confirmed (explains the screenshot observation on PDF p.4 vs p.5) | `customersSummary()` `active` (last 60 days) vs the `SEGMENT_CTE` segment. Locally 78 vs 28. | Owners see contradictory numbers. |
| F12 | "New" covers both *no orders yet* and *first order within 30 days*, so customers with orders show as New. | Not a defect: works as defined in `SEGMENT_CTE` | `customers.repo.ts` comment block. | Wording only. Could be explained in the UI. |
| F13 | Customer phone numbers must be Indian mobiles (`^[6-9]\d{9}$`, also a DB CHECK). Landlines and foreign numbers are rejected. | Needs product decision | `lib/phone.ts`; `customers.phone` CHECK in `001_init.sql`. | Blocks foreign clients and landline-only customers. |
| F14 | A customer page shows orders, but not that customer's invoices or a payment timeline. | Confirmed gap | `CustomerDetailPage.tsx` has an "Order history" section only. | The profile requested in `04` is incomplete. |

### Legal / record-keeping decisions (no code change without owner or accountant input)

| # | Finding | Status | Evidence |
|---|---|---|---|
| F15 | Owners can permanently delete issued invoices, orders, or a customer with all their orders and invoices ("purge"). This leaves gaps in invoice numbering. | Needs product decision. It's a feature you asked for, with warnings shown. | `invoices.service.ts` `deleteInvoice`, `orders.service.ts` `deleteOrder`, `customers.service.ts` purge. |
| F16 | Invoice numbers print the **calendar** year with a lifetime sequence (`INV-2026-000123`). There is no financial-year (Apr–Mar) reset. | Needs accountant decision | `lib/numbering.ts`, `invoices.service.ts`. |
| F17 | GSTIN is stored and printed, but there is no tax calculation, HSN/SAC, place of supply or tax split. The app makes no GST compliance claim. | Confirmed absent; out of scope until tax rules are agreed | `shop.schemas.ts` gstin. No tax columns. |

### Verified absent (`07`–`09`): nothing to fix, scope decision needed

| Module | Status |
|---|---|
| Product catalogue / SKU | Not present. Line items are free text (`order_items.item_name`). |
| Inventory / stock movements | Not present |
| Suppliers / purchase orders | Not present |
| Expenses / profit | Not present. No profit figure is shown anywhere, which is correct given no cost data. |

### Low severity / informational

| # | Finding | Status |
|---|---|---|
| F18 | "Best-selling items" groups by exact item text ("Milk" ≠ "milk") and ranks by line value before order-level discount. | Confirmed, low |
| F19 | Branch membership isn't re-checked on each request (the token's `shopId` is trusted for 7 days). | Not exploitable today: there is no remove-member or invite feature. Re-check if staff accounts are added. |
| F20 | The `staff` role exists in the schema, but no flow creates staff, so `PUT /shop` has no owner check. | Not applicable today; same condition as F19. |
| F21 | When the prior period is 0, dashboard KPIs hide the % change but still show an up/down arrow. | Confirmed, cosmetic |

### Verified working (no change needed)

- **Money and totals:** paise integers; totals, discount and paid amounts are recomputed and validated on the server. A DB CHECK keeps total = subtotal − discount and paid ≤ total.
- **Duplicate prevention and numbering:**
  - Duplicate order submits are blocked (idempotency key plus a unique index).
  - Order and invoice numbers come from row-locked per-shop counters, so they're safe under concurrent creation.
  - One live invoice per order is enforced by a partial unique index.
- **Invoices:** immutable snapshots; reissue keeps the number and adds a revision; cancelling an order voids its invoice.
- **Tenancy:** every data query is shop-scoped. Lookups that use only an id (`findItems`, `latestInvoiceForOrder`) run only after a shop-scoped order check.
- **Customers:** duplicate phone numbers are blocked per shop (normalised `+91`/`0`/spaces). Archiving a customer keeps their orders and invoices.
- **Analytics:** no join multiplication in the KPI queries (checked each one). Date windows use IST.
- **Auth:** password reset is safe (hashed, single-use, 30 minutes, throttled, no account enumeration).
- **Filters:** column filters and date presets work (left unchanged at your request).

### Could not verify

- Production (Supabase/Render) data and configuration. Only local data was checked.
- Real email delivery (local uses the console provider).
- Behaviour on physical mobile devices (only narrow-viewport browser checks are possible).
- Tax and legal requirements (F16, F17): these need an accountant.

---

## 4. Prioritised implementation plan (Checkpoint 1)

### P0 — will implement now (verified defects; no business-rule decision needed)

| Item | Change | Files | Risk | Test | Acceptance |
|---|---|---|---|---|---|
| T0 (F5) | Add an integration test suite using Node's **built-in** test runner (`node:test` + existing `tsx`, **no new dependency**). Runs against a disposable local DB `crm_test`, created from migrations. | `backend/test/*`, `backend/package.json` script | None (test-only DB) | `npm test` | Suite runs green and covers money, invoices, tenancy and auth |
| P0-1 (F1) | Throttle failed logins per email and per IP (same in-memory pattern as forgot-password). Return 429 with a clear message. Successful logins are unaffected. | `auth.service.ts`, `auth.routes.ts` | Low | Test: 10 bad logins → 429; good login works before the limit | |
| P0-2 (F2) | "Oldest unpaid orders" shows only non-cancelled orders with money due (unpaid or partly paid). Adds an API-only `due=true` list option; the filter UI is not touched. | `orders.schemas.ts`, `orders.repo.ts`, `api/endpoints.ts`, `DashboardPage.tsx` | Low | Test: a cancelled unpaid order is excluded and a partial one is included | |
| P0-3 (F3) | The Average bill value tile says "30d", matching the number shown. | `DashboardPage.tsx` | None | Visual check | |
| P0-4 (F4) | The customer page's "Orders" count excludes cancelled orders, matching the list and the other figures. | `customers.repo.ts` | Low | Test: list count = detail count | |

### P1 — needs your decision before implementation (financial / high impact)

| Item | Proposal | Migration impact |
|---|---|---|
| P1-A (F6, F7, F8) | **Payment ledger**: new `payments` table (amount, date, method cash/UPI/card/bank/other, reference, note, who). "Record payment" adds a payment instead of overwriting. Payment history and removal (reversal) on the order page. `orders.amount_paid_paise` stays as the running total, updated in the same transaction. Analytics "Payments received" counts by **payment date**. **Payments no longer flag invoices for reissue.** The invoice keeps "paid / balance as at issue", and the order page shows the live balance. | **Additive**: new table. Backfill = one "opening balance" payment per order that already has money paid, dated to the order date, method "not recorded". No existing values are changed. |
| P1-B (F9) | **Refunds on cancel**: when cancelling an order that has payments, ask "Refund ₹X?" and record it as a negative payment (refund). Or keep the money as customer credit. | Uses P1-A. Existing cancelled orders with money are left as they are and listed for you to review. |
| P1-C (F10) | A ₹0 order counts as **Paid**. | Relaxes a CHECK constraint (additive) and fixes new orders. Repairing existing ₹0 orders (none locally) would be an explicit, reported step. |
| P1-D (F11) | Rename the segment tab **Active → "Regular"** (or similar). The KPI stays "Active customers (bought in 60 days)". Each segment gets a short explanation. | Labels only |
| P1-E (F14) | Customer page: add **Invoices** and (with P1-A) **Payments** sections. | Read-only; no schema change |
| P1-F (F13) | Allow international or landline numbers (E.164). | Changes a CHECK constraint; existing data is unaffected. Needs your call. |

### P2 — not built; needs a scope decision (`07`, `08`, `09`, parts of `10`)

Product catalogue, inventory and stock ledger, suppliers and purchases, expenses, profit, FY invoice numbering, and GST tax calculation.

Per `00_START_HERE` and checklists `07`–`09`, these must not be built until you confirm:
- the shop types you target (grocery / textile / café …),
- whether stock is tracked per branch,
- how cost is captured,
- your accountant's rules for invoice numbering and GST.

---

## 5. Status after implementation (30 Oct 2026)

| Item | Status |
|---|---|
| F1 login throttle, F2 oldest unpaid, F3 30d label, F4 order count, F5 tests | **Fixed** (P0) |
| F6–F9 payment ledger, payment-date receipts, no reissue on payment, refunds | **Fixed** (approved) |
| F10 ₹0 orders | **Fixed** (approved) |
| 07 Products & inventory | **Built** (approved) |
| F11, F13, F14, F15–F17, 08, 09 | Not changed: declined for now or need a decision |

Details: `CRM_IMPLEMENTATION_LOG.md`. Evidence: `CRM_TEST_RESULTS.md`.
