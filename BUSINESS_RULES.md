# CartWell — Business Rules and Definitions

This is the single reference for how CartWell calculates money, statuses and every reported figure. Each rule names where it's enforced and the test that covers it (tests are in `backend/test/`). If a screen, the API, the database or a PDF ever disagrees with this page, that's a bug.

All dates and "today" are in **India time (IST)**. A "last N days" window means **today plus the N−1 days before it**. It never includes future dates.

---

## 1. Money

| Rule | Detail | Enforced in | Test |
|---|---|---|---|
| Unit | Whole **paise** (integers), never floating point. Quantities are milli-units (2.5 = 2500) | DB `BIGINT`, `lib/money.ts` | orders |
| Line amount | `quantity × unit price`, rounded **half-up** to the paisa, once per line | `lineTotalPaise()` | orders: 1.5 × ₹33.33 = ₹50.00 |
| Subtotal | Sum of line amounts | `computeTotals()` | orders |
| Discount | One order-level amount, at most the subtotal. No line discounts | `computeTotals()` + DB check | orders |
| Total | `subtotal − discount`. **No tax is calculated**; GSTIN is only printed | `computeTotals()` + DB check `orders_total_ck` | orders |
| Who calculates | Always the server. Totals sent by the browser are ignored | `computeTotals()` | orders: client totals ignored |
| Limits | Quantity up to 99,999 (3 decimals); price up to ₹1 crore per unit; up to 200 lines; a total too large to add up exactly (over about ₹90 lakh crore) is refused | schemas, `computeTotals()` | rules |

## 2. Payments and refunds

| Rule | Detail | Enforced in | Test |
|---|---|---|---|
| Ledger | Each payment and each refund is its own entry: amount, date, method, reference, note, who | `payments` table | payments |
| Paid on an order | Payments − refunds, ignoring removed (voided) entries. `orders.amount_paid_paise` holds this and is recalculated in the same transaction as every entry | `syncPaid()` | payments: ledger invariant after the suite |
| Balance due | `total − paid`. A **cancelled** order owes **₹0** | screens, all reports | customers, analytics |
| Limits | A payment can't exceed the balance due (no overpayment or customer credit). A refund can't exceed what was paid | `recordEntry()` | payments |
| Dates | A payment date can't be in the future. Money entered with a new order is dated the order date if that's in the past, otherwise **today** | `recordEntry()`, `createOrder()` | payments, rules |
| Cancelled orders | No new payments. Refunds are allowed. Cancelling can refund everything paid in one entry (you choose) | `recordEntry()`, `setStatus()` | payments |
| Duplicates | Retrying with the same key never records twice | idempotency key + unique index | payments |
| Mistakes | Owners can remove an entry. It stays in the history, crossed out with a reason. Removing a payment that would leave more refunded than paid is refused | `voidEntry()` | payments |
| States | Entries are recorded by hand, after the money moved. There's no gateway, so no "initiated" or "failed" states | — | — |

## 3. Statuses

### Payment status (derived; never set by hand)

| Status | When |
|---|---|
| Paid | paid ≥ total. This includes a **₹0 order** |
| Partly paid | 0 < paid < total |
| Unpaid | paid = 0 and total > 0 |

Enforced by `derivePaymentStatus()` and DB check `orders_payment_ck`. Tests: orders, payments.

### Order status (set by you, with one automatic step)

| From → to | Rule |
|---|---|
| Any → Completed / Open / Cancelled | Allowed by hand. A completed order can still be unpaid (credit) |
| Open → **Completed automatically** | When it's fully paid **and** has an issued invoice, whichever happens last (006) |
| → Cancelled | Its issued invoice becomes **Cancelled**, its stock goes back, and refunding what was paid is offered. It can't be edited, paid or invoiced until reopened |
| Cancelled → Open/Completed (reopen) | Stock is taken again. **Refused** if the stock has since run out (unless selling below zero is allowed) |

Payment status and order status are **independent**: a paid order can be open (not yet handed over), and a completed order can be unpaid.

### Invoice status

| Status | Meaning |
|---|---|
| Issued | The current invoice. **At most one per order** (unique index) |
| Needs reissue | Issued, but the order's **items, prices, discount, notes or date** changed afterwards. Payments **don't** cause this |
| Replaced | An older revision; reissuing keeps the number and adds Rev 2, 3, … |
| Cancelled | The order was cancelled |

An invoice is an **immutable snapshot**. Shop, customer, items and amounts are copied when it's issued, and later edits never change it. Its paid/balance lines are "as on the invoice date" (printed on the invoice). Numbers come from a per-branch sequence (`INV-[code-]YYYY-NNNNNN`, the year it was issued) and are safe under concurrent use. *Financial-year numbering and GST rules need your accountant (not built).*

## 4. Customers

| Label | Rule (by order date; cancelled orders ignored) |
|---|---|
| New | No orders yet, or first order in the last 30 days |
| Forgotten | Last order 60+ days ago |
| VIP | Top 10% by spend in the last 180 days (spend > 0) |
| Active (tab) | Everyone else |

- Each customer has exactly one label (`SEGMENT_CTE` in `customers.repo.ts`).
- **"Active customers" (the KPI)** is a different figure: customers who **bought in the last 60 days**, whatever their label. *Pending your decision: rename the tab so the two don't share a word.*
- A customer's orders, total spent, average order and payments pending all **exclude cancelled orders**. Archiving a customer keeps their orders and invoices.
- One customer per mobile number per branch. `+91`, `0` and spaces are removed before comparing.
- **Walk-in sales** (orders with no customer) count as sales, payments and stock. They never count as a customer: not in active customers, top customers or visit gaps.

## 5. Reported figures

All figures are per branch. All money figures exclude cancelled orders unless stated.

| Figure | Definition | Date basis |
|---|---|---|
| Total sales | Sum of order totals | Order date, in the window |
| Total orders | Number of orders | Order date |
| Average bill value | Total sales ÷ total orders, same window | Order date |
| Collection rate | Paid on those orders ÷ their sales | Order date |
| Payments pending (analytics) | Balance due on the window's orders | Order date |
| **Payments received** | Payments − refunds entered **on that date**, on any order (including older ones). Removed entries are excluded | **Payment date** |
| Payment collection status | Orders and amount due per payment status, in the window | Order date |
| Highest-spending customers | Sum of order totals per customer (walk-ins excluded), top 5 | Order date |
| Best-selling items | Sum of **line amounts** per item name, before the order-level discount, top 5 | Order date |
| Active customers | Distinct customers with an order in the last 60 days | Order date |
| Repeat rate | Customers with 2+ orders ÷ customers with 1+ | All time |
| Visit gap | Average days between a customer's consecutive orders | All time |
| Invoiced · 30d | Sum of issued invoices' totals | Invoice date |
| Due on invoices | Live balance due of orders that have an issued invoice | Now |
| 10 pm summary | Orders, sales, payments and new customers **entered** between 10 pm yesterday and 10 pm today (late entries roll into the next summary) | Entry time |

- Comparisons use the previous window of the same length. When that window is empty, the change shows "no prior data" instead of a percentage.
- Proven against a hand-calculated fixture and against the order list: `analytics.test.ts`. Also checked against independent SQL on a 388-order shop (see `CRM_TEST_RESULTS.md`).
- **No profit is calculated anywhere.** Cost price is reference only, and refunds, returns and expenses aren't modelled for profit.

## 6. Stock (products that track stock)

| Rule | Detail |
|---|---|
| Level | The sum of the product's stock movements, never a number someone types over |
| Orders | Take stock when saved. Edits post the difference; cancel puts it back; reopen takes it again; deleting an order (or a customer with their orders) puts it back |
| Not enough stock | The whole order is refused with exactly what's short. The "Allow selling when stock runs out" setting lets it go below zero (shown red / low) |
| Concurrency | Product rows are locked in a fixed order: two sales of the last unit, exactly one succeeds |
| Low stock | At or below the product's warning level, or below zero |
| History | Past orders keep their own item name and price; editing or archiving a product changes nothing in the past |

## 7. Input validation (server-side; the browser repeats it for quick feedback)

| Field | Rule |
|---|---|
| Customer name | Required, up to 120 characters |
| Mobile | Indian mobile, 10 digits starting 6–9 (`+91`/`0`/spaces stripped). *International numbers pending your decision* |
| Email | Optional, valid format |
| Dates (order, payment, filters, summary) | A real calendar date (31 Feb is refused), YYYY-MM-DD. Payment dates not in the future |
| Amounts | Up to 2 decimals, not negative. Payments and refunds must be more than ₹0 |
| Quantities | More than 0 (stock counts may be 0), up to 3 decimals |
| Text | Notes up to 1,000 characters, payment notes 300, references 100 |
| Logo | PNG, up to 400 KB (checked by file signature) |
| References | A customer, product or order must belong to your branch, or the request is refused (404/400) |
| Errors | Field-level messages (400/409). An unexpected error never shows internal details |

## 8. Data repairs applied by migrations

| Migration | What changed in existing data |
|---|---|
| 006 | Open orders that were fully paid and invoiced → Completed |
| 007 | One "opening" payment entry per order that already had money paid. **No values changed** |
| 008 | ₹0 orders marked unpaid → Paid (invoiced ones → Completed). Invoice snapshots untouched |
| 009, 010 | None (new tables/columns only) |

Each migration was rehearsed on a copy of the local data before release.
