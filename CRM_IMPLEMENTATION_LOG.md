# CartWell CRM — Implementation Log

Findings (F#) and plan items (P0-#, P1-#) refer to `CRM_AUDIT_REPORT.md`.
All testing used synthetic data in separate local databases:
- `crm_test`: wiped and rebuilt from the migrations by every automated test file.
- `crm_e2e_test`: browser checks.

Your development database `crm_dev` and production were **not touched**.

---

## Checkpoint 2 — P0 batch (30 Oct 2026)

### T0 — Automated test suite (F5)

- **Change:** an integration suite that runs the real API against a disposable database.
  - Uses Node's built-in `node:test` runner and `fetch`, plus the existing `tsx`. **No new dependency.**
  - Commands: `npm test` and `npm run typecheck` (the latter now also type-checks the tests).
  - Safety guard: the suite refuses to run unless the database is local and its name ends in `_test`.
- **Files:**
  - `backend/test/helpers.ts`
  - `backend/test/{orders,invoices,customers,tenancy,analytics,auth}.test.ts`
  - `backend/tsconfig.test.json`
  - `backend/package.json` (`test` and `typecheck` scripts)
- **Coverage:**
  - Server-side totals and rounding; rejection of over-discount and overpayment.
  - Idempotent order creation; 10 concurrent orders get unique sequential numbers.
  - Payment status transitions; auto-complete when paid and invoiced.
  - Invoice: no duplicates, outdated → reissue keeps the number, cancel → void, PDF and public share link.
  - Invoice summary counts each order once.
  - Customer phone normalisation and duplicate block; search; archive keeps history.
  - **Two-shop isolation** across every read, write and delete route.
  - Analytics reconciled against a hand-calculated fixture (paid, partial, unpaid, cancelled, previous-period), and checked against the order list for the same window.
  - An empty shop returns zeros.
- **Baseline run on the unchanged code: 23/23 passed.**

### P0-1 — Login brute-force protection (F1)

- **Change:** failed logins are limited to 5 per account and 20 per IP address in 15 minutes. After that the API returns 429 with "Too many failed attempts. Please try again in N minutes, or reset your password."
  - A successful login clears that account's failures.
  - Only failures count, so normal use is never slowed down.
- **Files:**
  - `backend/src/lib/throttle.ts` (new)
  - `backend/src/modules/auth/auth.service.ts`
  - `backend/src/modules/auth/auth.routes.ts`
- **Database:** none.
- **Tests:** `auth.test.ts`, 4 tests. They **failed before the fix** (2 of 4) and pass after. A manual API check showed 401×5 then 429. The browser check confirms the message appears on the login page.
- **Known trade-offs:**
  - Someone who knows an owner's email can lock that account for 15 minutes by guessing wrong. Password reset still works during the lock.
  - Counters live in memory: they reset when the server restarts, and a multi-server setup would need a shared store. Render runs one instance today.

### P0-2 — "Oldest unpaid orders" on the Dashboard (F2)

- **Change:** the panel now lists orders that still owe money: not cancelled, and paid less than the total. Unpaid **and** part-paid orders appear; cancelled orders no longer do.
  - Done with a new API-only list option `due=true`. The column filters are **unchanged**, as you asked.
- **Files:**
  - `backend/src/modules/orders/orders.schemas.ts`
  - `backend/src/modules/orders/orders.repo.ts`
  - `frontend/src/api/endpoints.ts`
  - `frontend/src/pages/DashboardPage.tsx`
- **Database:** none.
- **Tests:** an orders test (failed before, passes after). In the browser check, the panel shows the unpaid and part-paid orders and not the cancelled one.

### P0-3 — Average bill value label (F3)

- **Change:** the suffix now reads "30d", matching the 30-day figure it shows. The sparkline stays a 7-day rolling line; its accessible label already said so.
- **Files:** `frontend/src/pages/DashboardPage.tsx`.
- **Tests:** browser check.

### P0-4 — Customer order count consistency (F4)

- **Change:** the customer page's "Orders" (and "Average order") now exclude cancelled orders, the same as the customer list, Total spent and Payments pending.
- **Regression caught and fixed during the recheck:** the delete dialog used the same count to choose between "delete" and "archive". A customer with only cancelled orders would have been offered "Delete" and then actually archived.
  - The API now also returns `allOrderCount` (including cancelled), and the dialog uses that.
  - The customer hover card also shows a consistent number now.
- **Files:**
  - `backend/src/modules/customers/customers.repo.ts`
  - `frontend/src/types/index.ts`
  - `frontend/src/pages/customers/CustomerDetailPage.tsx`
- **Tests:**
  - The customers test (failed before: expected 1, got 2; passes after).
  - A new test: a customer with only a cancelled order shows 0 orders but is archived, and the order is kept.
  - Browser check: the page shows "Orders 0" and the dialog says "has 1 order … Archive customer".

### Batch verification

| Check | Result |
|---|---|
| `backend: npm run typecheck` (src + scripts + tests) | Pass |
| `backend: npm test` | **29/29 pass** |
| `backend: npm run build` | Pass |
| `frontend: tsc --noEmit` / `npm run build` | Pass |
| Browser check (`crm_e2e_test`, desktop 1440px) | 8/8 pass, no page errors |

### Recheck protocol

1. **What changed and why:** T0 (F5), P0-1 (F1), P0-2 (F2), P0-3 (F3), P0-4 (F4). Each finding was confirmed in code before the change, and F2/F4 also in local data.
2. **Files and database objects:** listed above. **No schema or data changes. No migrations.**
3. **Tests:** written first where possible and seen failing, then passing. Full suite 29/29.
4. **UI vs stored data:** yes. The dashboard panel and customer page were compared with the API and the fixture records.
5. **Adjacent workflows:**
   - The delete-customer dialog regression was found and fixed.
   - Orders list filters are untouched; `due` is a separate option.
   - Login error display was verified.
6. **Unresolved assumptions:** none for P0. The decisions for P1 are listed in the audit report.
7. **Safe to proceed:** yes. P1 waits for your decisions on the financial changes (payments, refunds, ₹0 orders), as `00_START_HERE` requires.

---

## Decisions received (30 Oct 2026)

| Question | Your answer |
|---|---|
| Payment ledger (F6, F7, F8) | **Approved** |
| Refund when cancelling an order that has payments (F9) | **Approved**: ask, and record the refund |
| ₹0 orders count as Paid (F10) | **Approved** |
| Rename the "Active" tab, international phones, customer invoices/payments sections | Not now |
| New modules | **Products & inventory** approved. Suppliers and expenses not now |

---

## Checkpoint 3, module 1 — Payment ledger (P1-A, P1-B)

**Why:** F6 (payments were one overwritten number), F7 ("Payments received" wasn't money received), F8 (every payment flagged the invoice for reissue), F9 (no refunds).

**What changed**

- **Database (`007_payments.sql`, additive):**
  - New `payments` table: payment or refund, amount, method, date, reference, note, who recorded it, and void fields.
  - Each order that already had money paid gets **one opening entry** for exactly that amount, dated to the order date, method "not recorded".
  - No existing column or value is changed.
- **Rules (API):**
  - Each payment or refund is its own entry. `orders.amount_paid_paise` is **recalculated from the ledger** in the same transaction, with the order row locked.
  - A payment can't be more than the balance due. A refund can't be more than what was paid. Dates can't be in the future.
  - A cancelled order takes no payments, but refunds are allowed.
  - A retried request (same key) never records twice.
  - A mistaken entry is **voided**, not deleted (owners only, with an optional reason). It stays in the history, crossed out.
  - Removing a payment that would leave more refunded than paid is refused, with "Remove the refund first."
  - **Payments no longer mark the invoice "Needs reissue".** Item or price edits still do.
  - Cancelling can refund everything paid in one entry, with the method you choose.
  - Old endpoints kept for a cached copy of the old app: `PATCH /orders/:id/payment` ("total paid so far") and an `amountPaid` sent with an order edit. Both record the difference as one ledger entry.
- **Reports:**
  - Analytics **"Payments received"** now means money received **by payment date** in the period (payments minus refunds), including payments on older orders. It has a previous-period comparison and a daily series.
  - The daily table's "Received" column uses the same definition.
  - The 10 pm summary's "Payments received" = money entered that day (consistent with the rest of the summary).
  - Dashboard "Collection rate" is unchanged: the share of the period's sales already paid.
- **Screens:**
  - **Order page:**
    - "Record payment" (amount defaults to the balance due; Cash, UPI, Card, Bank or Other; date; reference; note) and a "Refund" button.
    - A **Payments** history showing who recorded each entry, with received / refunded / balance totals and owner-only removal.
    - The cancel dialog offers "Refund ₹X paid", ticked by default.
  - **New order form:** choose how the amount paid at creation was paid.
  - **Edit order form:** "Paid so far" is read-only. Lowering the total below what was paid is refused, with "Record a refund on the order page first."
  - **Invoice (screen and PDF):** "Paid and balance as on the invoice date" under the totals.
  - A **cancelled order shows ₹0 balance due** on its page (it already counted as ₹0 everywhere else). This bug was there before; I found it during the mobile check.

**Files**

- Backend:
  - `db/migrations/007_payments.sql`
  - `src/modules/payments/{payments.schemas,payments.repo,payments.service,payments.routes}.ts` (new)
  - `src/modules/orders/{orders.service,orders.repo,orders.schemas,orders.routes,totals}.ts`
  - `src/modules/dashboard/dashboard.routes.ts`
  - `src/modules/invoices/invoicePdf.ts`
  - `src/app.ts`
  - `scripts/seed.ts` (new signatures)
- Frontend:
  - `components/orders/Payments.tsx` (new)
  - `components/orders/OrderForm.tsx`
  - `pages/orders/{OrderDetailPage,OrderEditPage}.tsx`
  - `pages/AnalyticsPage.tsx`
  - `components/layout/DailySummaryModal.tsx`
  - `components/invoices/InvoiceView.tsx`
  - `api/endpoints.ts`, `types/index.ts`

**Tests**

- `payments.test.ts`: 16 tests covering entries, limits, idempotency (two identical requests at once), method at creation, cancelled orders, refunds, cancel-with-refund, voiding and its guard, invoices not outdated by payments, edits, the older API, and two-shop isolation.
- After the suite, a **ledger check over every order it created** confirms the paid total equals the ledger: 0 differences.
- `analytics.test.ts`: received-by-payment-date, refunds subtract, voided entries excluded, the daily series adds up to the KPI, and the daily summary. This test is timezone-safe after 10 pm IST.
- `migrations.test.ts`: upgrade from 006 with paid, part-paid, unpaid and cancelled orders. Exactly one opening entry each, and order rows identical before and after.
- **Upgrade rehearsal on a copy of your dev data** (`crm_upgrade_test`, 390 orders, 320 invoices):
  - Order and invoice checksums are identical before and after.
  - 349 opening entries total ₹2,84,234.25, equal to the recorded paid amounts.
  - 0 orders disagree with the ledger.
- Browser (`crm_e2e_test`), 18/18:
  - The opening entry shows; a partial payment with a reference.
  - Overpayment is refused in the dialog.
  - A refund in red; void with a reason (crossed out); balance updates.
  - Edit page read-only "Paid so far" with the below-paid guard.
  - Cancel with a UPI refund.
  - The invoice footnote.
  - No horizontal scroll at 390px; no page errors.
  - The PDF was rendered and checked by eye.
- **Full suite: 48/48 at the end of this module.**

**Recheck protocol**

1. **Justification:** F6–F9, as approved.
2. **Files and database objects:** listed above. New table `payments`, with indexes `payments_shop_idem_uq`, `payments_order_idx` and `payments_shop_paid_on_idx`.
3. **Tests:** above. All pass.
4. **UI vs stored data:** checked in the browser against API values. The ledger invariant is checked in SQL.
5. **Adjacent workflows:**
   - Order create and edit, cancel and reopen, invoice generation and reissue, auto-complete, analytics, daily summary, and the seed script (updated).
   - Customer totals are unchanged because they still read `amount_paid_paise`.
6. **Unresolved:**
   - The **10 invoices already flagged "Needs reissue"** only because of past payments stay flagged. I left them, because changing their stored version would alter historical rows. You can reissue them, or ask me for a one-off script that clears the flag where nothing billed changed.
   - Payment **receipts** (a printable receipt per payment) are not built.
7. **Safe to proceed:** yes.

## Checkpoint 3, module 2 — ₹0 orders count as Paid (P1-C)

- **Why:** F10, approved.
- **Change:**
  - `derivePaymentStatus`: paid ≥ total means "paid", so ₹0 of ₹0 is paid.
  - `008_zero_total_orders.sql` replaces the payment-status rule: "unpaid" needs something owed, and "paid" means paid = total.
- **Data repair** (approved, in the migration): existing ₹0 orders marked unpaid become paid, and the ones with an issued invoice are completed (the rule from 006). Issued invoice snapshots are left alone. Your local data has **no** ₹0 orders, so this changes nothing there.
- **Bug caught by the upgrade test before it shipped:** the first draft repaired the data while the old rule was still in place. The migration would have **failed on Supabase**. It's now ordered drop rule → repair → add rule, all in one transaction.
- **Tests:**
  - Free and 100%-discount orders are paid, not "due", not counted as unpaid on the dashboard, and complete when invoiced. Editing one to have a price makes it unpaid.
  - The upgrade test checks repair, completion, untouched invoice snapshots, and that the new rule is enforced.
  - Upgrade rehearsal on the dev-data copy: the migration applied cleanly; orders and invoices are unchanged (no ₹0 orders).
- **Full suite: 50/50.**
- **Safe to proceed:** yes.

## Checkpoint 3, module 3 — Products & inventory (P2, approved)

**Why:** checklist 07, approved by you. The audit confirmed the module didn't exist (line items were free text only).

**Defaults chosen** (07 says to document them; all reversible):

| Question | Default |
|---|---|
| Stock per branch? | Yes, per branch |
| When is stock deducted? | When the order is saved. Cancel puts it back, reopen takes it again, an edit posts the difference, delete (and delete-customer-with-orders) puts it back |
| Selling below zero? | **Refused** with an exact message. Setting **Settings → Stock → "Allow selling when stock runs out"**. When on, stock goes negative and shows red and "low" |
| Variants | Each variant is its own product |
| Units | Products have a unit (pcs/kg/m…) for stock. Order and invoice lines stay qty-only, as you asked earlier |
| Free-text items | Still allowed |
| Cost price | Stored for reference; no profit anywhere (09) |
| Product edits | Never change past orders or invoices (name and price are copied onto the line) |
| Deleting products | Not possible; **archive** instead (history refers to them) |

**What changed**

- **Database (`009_products_inventory.sql`, additive):**
  - `products`.
  - `stock_movements`: the ledger; stock = sum, in milli-units.
  - `order_items.product_id` (optional).
  - `shops.allow_negative_stock` (default off).
- **API:** `/api/products`, covering list (active / low / archived, search), detail with history and running balance, create (with opening stock), edit, archive/restore, stock entries (received / write-off / stock count, idempotent), and the low-stock count.
  - Orders validate that linked products belong to the shop. A single reconcile function (`syncOrderStock`) runs in the order's transaction with product rows locked in id order, so it's safe under concurrency and can't deadlock.
- **Screens:**
  - **Products** in the menu, with a low-stock count.
  - A list with All / Low stock / Archived tabs.
  - Add and edit forms.
  - A product page with stock, prices, warning level, **stock history** (who, what, change, stock after; sales link to their order) and **Update stock**.
  - **Order form:** the item name searches products (stock and price shown; keyboard-friendly), and picking fills the price. There's a stock hint under the line, and typing over the name unlinks it.
  - **Order page:** linked items link to their product.
  - **Settings:** the stock setting.
- **Also caught by the typecheck:** the new shop setting would have been copied into every invoice's shop snapshot. It's now excluded.

**Files**

- Backend:
  - `db/migrations/009_products_inventory.sql`
  - `src/modules/products/{products.schemas,products.repo,products.routes,stock.service}.ts` (new)
  - `src/modules/orders/{orders.schemas,orders.repo,orders.service,orders.routes,totals}.ts`
  - `src/modules/customers/{customers.service,customers.routes}.ts`
  - `src/modules/shop/{shop.repo,shop.schemas,shop.routes}.ts`
  - `src/modules/invoices/invoices.service.ts`
  - `src/app.ts`
- Frontend:
  - `components/products/ProductParts.tsx`, `components/orders/ProductPicker.tsx` (new)
  - `pages/products/{ProductListPage,ProductFormPages,ProductDetailPage}.tsx` (new)
  - `components/orders/{LineItemsEditor,OrderForm}.tsx`
  - `pages/orders/OrderDetailPage.tsx`
  - `pages/SettingsPage.tsx`
  - `components/layout/AppShell.tsx`, `App.tsx`
  - `api/endpoints.ts`, `types/index.ts`

**Tests:** `products.test.ts` (15, including the stock invariant after the suite), the 009 upgrade test, and the rehearsal on the dev-data copy (all 1,286 lines unchanged). Browser inventory script 18/18. **Full suite 66/66.**

**Recheck protocol:**

1. **Justification:** 07, approved.
2. **Files and database objects:** listed above.
3. **Tests:** all pass.
4. **UI vs data:** stock levels and history in the browser match the API and the movements.
5. **Adjacent workflows:**
   - Orders: create, edit, cancel, reopen and delete.
   - Customer purge; invoices (snapshot unchanged); settings save; seed script.
6. **Unresolved:**
   - Shop types, variants, batch/expiry and stock valuation weren't specified (07), so they're not built.
   - Suppliers and purchases (08) and expenses (09) were declined for now.
   - Stock entries can't be voided yet; a stock count corrects mistakes.
7. **Safe to proceed:** yes.

## Checkpoint 4 — UX and reporting

Done inside each module rather than as a separate redesign, since you asked to keep existing functionality and filters as they are:
- "Payments received" now has a clear definition.
- The "30d" label is fixed.
- Cancelled orders owe ₹0 on their page.
- Every new screen has empty, loading and error states, and has been checked at 390px.
- **The column filters were left untouched**, as you asked.

## Checkpoint 5 — Final verification

See `CRM_TEST_RESULTS.md`.
- All commands pass.
- Upgrade rehearsal on a copy of real data passed.
- Two-shop authorization tested.
- Desktop and phone sweep of every page passed.
- KPI reconciliation is exact.
- Code scan is clean.
- `crm_dev` was confirmed unchanged.

### Fixed during final verification

- The seed script dated payments today (it now uses the order date).
- My own browser scripts needed fixes (wrong element, shared login between pages, hidden-input false positive). In every case the app was right.

## Not done (needs your decision or out of scope)

- Clearing the "Needs reissue" flag on the **10 invoices flagged earlier only because of payments**. Reissue them, or ask for a one-off script.
- Payment receipts.
- Voiding stock entries.
- Customer page invoices/payments sections, the "Active" tab rename, and international phone numbers (declined for now).
- Suppliers, expenses and profit; GST and FY invoice numbering (needs an accountant).
- Lint setup.
- Production deployment: **you** run migrations 006–009 on Supabase, then push (see `DEPLOYMENT.md`).

---

## Round 2 — files 12 (POS) and 15 (business rules), 30 Oct 2026

**Decision received:** POS scope = **walk-in sales only**. Barcode scanning, split payment at checkout and receipts were not chosen.

### Module A — Rule and validation fixes (R1–R4)

- **R1:** one `dateInput` validator (a real calendar date, year ≥ 1900) is now used for the order date, payment date, order and invoice list filters, and the 10 pm summary date. An invalid date gives 400 "Not a valid date".
- **R2:** every "last N days" query ends today. A future-dated order counts from its own date, the same as the daily chart.
- **R3:** money entered with a new order is dated the order date if that's in the past, otherwise today.
- **R4:** the subtotal must stay an exact integer (`Number.isSafeInteger`); otherwise 400 "This order total is too large".
- **Files:**
  - `backend/src/lib/validation.ts`
  - `backend/src/modules/{orders/orders.schemas,orders/orders.service,orders/totals,payments/payments.schemas,invoices/invoices.routes,dashboard/dashboard.routes}.ts`
- **Database:** none.
- **Tests:** `rules.test.ts`, 7 tests. All 7 **failed before** the fixes (showing 500s, ₹200 vs ₹100, a future payment date, and 201 instead of 400) and pass after.
- **Docs:** `BUSINESS_RULES.md` holds every money rule, status and transition, customer label, reported figure (definition and date basis), stock rule and validation, each with where it's enforced and which test covers it.

### Module B — Walk-in sales (approved)

- **Database:** `010_walk_in_orders.sql` makes an order's customer optional. Additive; existing orders unchanged.
- **API:**
  - Create accepts `walkIn: true` (exactly one of: existing customer, new customer, walk-in).
  - Order lists show "Walk-in" and the search finds "walk".
  - The invoice snapshot is "Walk-in customer" with no phone. The PDF works.
  - Payments, refunds, edits, stock and auto-complete all work.
  - Walk-ins count as sales but never as a customer (active customers, top customers, visit gap: the gap query was fixed to skip them).
- **Screens:**
  - "Walk-in sale (no customer)" in the order form's customer box, with a note that walk-ins are usually paid in full.
  - "Walk-in" in the order and invoice lists (no hover card).
  - "Walk-in sale — no customer saved" on the order and edit pages.
  - Send invoice by WhatsApp opens WhatsApp's own contact chooser when there's no number. Before, it would have built a link to `91null`.
- **Files:**
  - Backend: `db/migrations/010_walk_in_orders.sql`, `src/modules/{orders/*,invoices/invoices.service,invoices/invoices.repo,customers/customers.repo}.ts`
  - Frontend: `components/customers/CustomerPicker.tsx`, `pages/orders/{OrderCreatePage,OrderDetailPage,OrderEditPage}.tsx`, `components/orders/OrdersTable.tsx`, `pages/invoices/InvoiceListPage.tsx`, `components/invoices/SendInvoiceModal.tsx`, `api/endpoints.ts`, `types/index.ts`
- **Tests:**
  - `walkin.test.ts`: 6 tests covering create, the exactly-one rule, list/search/due list, invoice/PDF/payments/refund/edit, "sales but not a customer", and stock.
  - The 010 upgrade test.
  - Browser walk-in script 9/9.
- **Typecheck findings fixed along the way:** the invoice type assumed every customer has a phone, and two list cells assumed a customer id.

### Recheck (both modules)

1. **Justification:** R1–R4 confirmed by failing probes; walk-in approved.
2. **Files and database objects:** listed above; the only schema change is the nullable `orders.customer_id`.
3. **Tests:** backend **80/80**.
4. **UI vs data:** the browser walk-in flow was checked against API values. The **all-pages sweep was re-run on a freshly seeded shop: 38/38** (desktop and phone, no errors, no failed calls, no horizontal scroll).
5. **Adjacent workflows:** invoices, sending, payments, stock, dashboard, customers summary, seed script.
6. **Unresolved:** the "Active" tab wording (R7); the other POS items were declined.
7. **Safe to proceed:** yes. Run migration **010** on Supabase before pushing this code.

---

## Round 3: remaining review files (A1–A7), 31 Oct 2026

**Environment:** Windows, Node 24. Dependencies were installed with `npm ci` from the lockfiles. There's no local PostgreSQL: you chose to check against Supabase live. So the **integration tests (`npm test`) were not run**. New tests were written and type-checked, and they'll run wherever `crm_test` exists.

**Your instructions:** login and password reset are untouched, and the existing UI design is kept. New controls reuse existing styles.

| Item | Change | Files |
|---|---|---|
| A1 | Export on Customers, Orders and Invoices fetches every page that matches the current tab, search, filters and sort (100 rows per request), not just the 25 rows on screen. The button is disabled while it works, and an error shows as a toast. Exporting selected rows is unchanged. All three lists sort with an `id` tiebreaker, so paging can't skip or repeat a row | `frontend/src/lib/csv.ts` (`fetchAllPages`), `pages/customers/CustomerListPage.tsx`, `pages/orders/OrderListPage.tsx`, `pages/invoices/InvoiceListPage.tsx` |
| A2 | Deleting an order that still has payment or refund entries counting is refused with 409 `ORDER_HAS_PAYMENTS` and a plain message. Deleting a customer together with their orders is refused with 409 `ORDERS_HAVE_PAYMENTS` when any of those orders has them. Removed (voided) entries don't block, so an owner can still clear a mistaken order in two deliberate steps. The bulk-delete warning on the Orders list says paid orders are kept; other screens already show the server's message | `backend/src/modules/payments/payments.repo.ts` (`countOrdersWithEntries`), `orders/orders.service.ts`, `customers/customers.service.ts`, `frontend/src/pages/orders/OrderListPage.tsx` |
| A3 | `POST /api/invoices/:id/share-link/reset` makes a new token, so the old link returns 404. The Send invoice dialog has a "Reset link" text button that asks for a second click, then swaps the link in the box and in the message | `backend/src/modules/invoices/invoices.{repo,service,routes}.ts`, `frontend/src/api/endpoints.ts`, `components/invoices/SendInvoiceModal.tsx` |
| A5 | Shop and branch phone accept 6–15 digits with `+ ( ) -` and spaces, or blank. Other text gets a field error under Phone. Existing values aren't changed; a bad one only has to be fixed when the shop details are next saved | `backend/src/modules/shop/shop.schemas.ts` |
| A6 | When the device asks for reduced motion, transitions are switched off. The loading spinner keeps turning | `frontend/src/index.css` |
| A7 | Vercel sends `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'`, `Referrer-Policy: strict-origin-when-cross-origin`, and a `Permissions-Policy` that blocks camera, microphone and location. The app uses no iframes or camera (checked). The CSP only stops framing; a full script policy would need testing on the live domains | `frontend/vercel.json` |

**Database:** no migrations and no data changes.

**Checks run**

| Check | Result |
|---|---|
| `backend: npm run typecheck` (src, scripts, tests) | Pass |
| `backend: npm run build` | Pass |
| `frontend: npm run build` (tsc and vite) | Pass |
| Shop-phone schema run directly with good and bad inputs | Accepts and refuses as specified |
| `backend: npm test` | **Not run**: no local PostgreSQL |
| Browser checks | **Not run**: needs a running API and database. Check live after deploy (below) |

**New tests (written, not yet run):**
- `orders.test.ts`: a paid order can't be deleted; once its payment is removed, it can; a customer with a paid order can't be purged.
- `invoices.test.ts`: reset kills the old link and the new one works; another shop can't reset it.
- `rules.test.ts`: shop and branch phone formats.

**Check on the live site after deploying:**
1. Export from each list with a filter that matches more than 25 rows. The file should hold all of them.
2. Try to delete an order that has a payment. It should be refused with the message.
3. Send invoice → Reset link (two clicks). The old link should stop opening.
4. Settings → phone "abc" should show an error; a landline should save.
5. Check the response headers on the Vercel URL.

**Recheck protocol**

1. **Justification:** findings A1, A2, A3, A5, A6 and A7, as approved.
2. **Files and database objects:** listed above; no database objects changed.
3. **Tests:** typecheck and builds pass. Integration tests weren't run (no database).
4. **UI vs data:** not checked in a browser; to be checked live.
5. **Adjacent workflows:**
   - Selected-row export, bulk delete error reporting and the order and customer delete toasts were reviewed in code.
   - Opening the send dialog still returns the existing link.
   - Login and password reset are untouched.
6. **Unresolved:** share-link expiry and a full CSP.
7. **Safe to deploy:** yes, once `npm test` passes somewhere with a database, or the live checks above pass.
