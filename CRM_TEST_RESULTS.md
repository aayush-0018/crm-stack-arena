# CartWell CRM — Test Results (Checkpoint 5)

Final run: 30 Oct 2026, on top of baseline commit `a0d811f`. Everything ran locally against **separate throwaway databases**. Your development database `crm_dev` was only read, never changed. That was confirmed at the end: still on migration 006, with 101 customers, 390 orders, 320 invoices and ₹2,84,234.25 paid, all unchanged.

## Commands and results

| Command | Result |
|---|---|
| `cd backend && npm run typecheck` (src + scripts + tests) | Pass |
| `cd backend && npm test` | **66/66 pass**, 26 suites, ~42 s |
| `cd backend && npm run build` | Pass |
| `cd frontend && npx tsc --noEmit` | Pass |
| `cd frontend && npm run build` | Pass (426 kB JS, 123 kB gzipped) |
| Lint | Not configured in this repository. Nothing was added, to avoid a new dependency. |

The baseline before any change was 0 tests (none existed). After the test harness was added, the unchanged code passed 23/23.

## Automated suite (`backend/test`)

Each file wipes `crm_test`, rebuilds it from the migrations, and runs the real API on a random port. The harness refuses to run against any database that isn't local and named `*_test`.

| File | Tests | What it proves |
|---|---|---|
| `orders.test.ts` | 12 | Server-side totals and half-up rounding; client totals ignored; over-discount and overpayment rejected; idempotent create; **10 concurrent creates get unique sequential numbers**; payment status transitions; auto-complete when paid and invoiced; delete cascades; `due=true` list; ₹0 orders are paid |
| `invoices.test.ts` | 5 | No duplicate invoices; outdated → reissue keeps the number and the old snapshot stays unchanged; cancel → void; PDF renders; public share link serves only its own invoice; summary counts each order once |
| `customers.test.ts` | 5 | Phone normalisation and duplicate block; partial-name and partial-phone search; archive keeps history; totals and counts exclude cancelled orders; a customer with only cancelled orders shows 0 orders but is still archived |
| `tenancy.test.ts` | 3 | **Two synthetic shops:** every read, write and delete route returns 404 across shops; you can't attach an order to another shop's customer; lists and analytics are scoped; you can't switch to a branch you don't belong to; no token or a bad token gives 401 |
| `auth.test.ts` | 4 | Login works; wrong password gives a generic 401; **5 failures lock that account for 15 minutes** without affecting others; success clears failures; per-IP throttle |
| `analytics.test.ts` | 3 | KPIs, payment breakdown and top lists **match a hand-calculated fixture** (paid, partial, unpaid, cancelled-excluded, previous period); the order list for the same window agrees with the KPI; an empty shop returns zeros; payments received are counted by payment date, refunds subtract, voided entries are excluded, the daily series adds up to the KPI; the 10 pm summary is timezone-safe |
| `payments.test.ts` | 16 | Ledger entries and limits; future dates refused; **two identical requests at once record once**; method at creation; cancelled orders: no payments but refunds allowed; refund limits; cancel-with-refund; void and its guard; **payments don't outdate invoices**; edits; the older "total paid" API; two-shop isolation. **After the suite: every order's paid total equals its ledger (0 differences).** |
| `products.test.ts` | 15 | Catalogue uniqueness, validation, search, low-stock list; receipt, write-off and stocktake; write-off beyond stock refused; idempotent stock entries; untracked products; **create, edit, cancel, reopen, delete and customer-purge keep stock right**; insufficient stock refuses the whole order (customer and order rolled back); reopen refused if the stock has since been sold; **two orders for the last unit at once: exactly one succeeds**; the allow-below-zero setting; product edits don't change past orders or invoices; two-shop isolation. **After the suite: every order's stock movements equal its tracked lines (0 differences).** |
| `migrations.test.ts` | 4 | **Upgrade tests:** 006→007 (one opening entry per paid order; order rows byte-identical), 007→008 (₹0 repair, completion, invoice snapshots untouched, new rule enforced), 008→009 (existing lines stay free-text, setting defaults off); and a fresh database applies every migration |

## Migration rehearsal on a copy of real local data

A copy of `crm_dev` (`crm_upgrade_test`; 390 orders, 1,286 order lines, 320 invoices) was migrated 006 → 009:

- Checksums of every **order, order line and invoice** row are identical before and after.
- `payments`: 349 opening entries totalling ₹2,84,234.25, equal to the paid amounts. **0 orders** disagree with the ledger.
- 008 changed nothing (there are no ₹0 orders). 009 left every existing line unlinked (free text).

**Bug caught here before shipping:** the first draft of 008 repaired data while the old rule was still active, so it would have **failed on Supabase**. It was reordered and re-verified.

## Browser checks (Chrome headless, `crm_e2e_test`)

| Script | Result | Covers |
|---|---|---|
| P0 | 8/8 | Dashboard "Oldest unpaid orders" (part-paid in, cancelled out), the 30d label, the customer count and delete dialog, login lockout message |
| Payments | 18/18 | Opening entry shown; partial payment with reference; overpayment refused; refund; void with reason (crossed out); balance updates; edit page read-only "Paid so far" and the below-paid guard; cancel with UPI refund; invoice footnote; 390px layout |
| Inventory | 18/18 | Empty state; create product through the form; receive stock; stock count; search and pick in the order form (keyboard); over-stock line warning; save refused with the exact stock message; save at a valid quantity; stock "Sold" entry linking the order; write-off; low-stock tab and menu badge; settings toggle; 390px layout |
| Full sweep | 38/38 | **All 13 pages at 1440px and 390px**: no page errors, no failed API calls, no horizontal scroll. Analytics in all four periods; the daily summary opens on both sizes; first Tab lands on a control with a visible focus style; every rendered form control has a label |

## KPI reconciliation on a realistic shop

On a seeded throwaway shop (100 customers, 388 orders, 319 invoices), the 30-day dashboard figures were compared with independent SQL against the base tables:

| Figure | API | SQL |
|---|---|---|
| Sales | ₹1,49,174.52 | ₹1,49,174.52 |
| Orders | 175 | 175 |
| Paid on those orders | ₹1,01,389.66 | ₹1,01,389.66 |
| Still due | ₹47,784.86 | ₹47,784.86 |
| Payments received (by payment date) | ₹1,04,659.63 | ₹1,04,659.63 |

**Seed-script issue found and fixed:** it recorded back-dated orders' payments as made today, so "received this month" equalled all money ever. Seeded payments are now dated on the order date.

## Code scan

- No TODO/FIXME, `debugger`, or stray `console.log` in changed code. The seed script's progress output is intentional.
- No secrets, `.env` files or real customer data in the changes. Tests use `@example.test` addresses and synthetic names.

## Not tested / limits

- Production (Supabase/Render) itself, and real email delivery.
- Physical phones (narrow viewport in Chrome only).
- Screen-reader walkthrough (labels and roles checked automatically, not with a real screen reader).
- Load beyond about 400 orders per shop.
- The stock-hint on an **edited** order's line doesn't count stock that order already holds, so it can warn too early. The server's check is correct.
