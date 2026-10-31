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
| Total | `subtotal − discount − returned`. **No tax is calculated**; GSTIN is only printed | `computeTotals()` + DB check `orders_total_ck` | orders |
| Who calculates | Always the server. Totals sent by the browser are ignored | `computeTotals()` | orders: client totals ignored |
| Limits | Quantity up to 99,999 (3 decimals); price up to ₹1 crore per unit; up to 200 lines; a total too large to add up exactly (over about ₹90 lakh crore) is refused | schemas, `computeTotals()` | rules |

## 2. Payments and refunds

| Rule | Detail | Enforced in | Test |
|---|---|---|---|
| Ledger | Each payment and each refund is its own entry: amount, date, method, reference, note, who | `payments` table | payments |
| Paid on an order | Payments − refunds, ignoring removed (voided) entries. `orders.amount_paid_paise` holds this and is recalculated in the same transaction as every entry | `syncPaid()` | payments: ledger invariant after the suite |
| Balance due | `total − paid`. A **cancelled** order owes **₹0** | screens, all reports | customers, analytics |
| Limits | A payment can't exceed the balance due (no overpayment or customer credit). A refund can't exceed what was paid | `recordEntry()` | payments |
| Deleting | An order with payment or refund entries still counting **can't be deleted**, and a customer whose orders have them can't be deleted with their orders. Cancel the order (with a refund) or archive the customer instead. An owner who removes those entries first can then delete | `deleteOrder()`, `deleteCustomer()`, `countOrdersWithEntries()` | orders |
| Dates | A payment date can't be in the future. Money entered with a new order is dated the order date if that's in the past, otherwise **today** | `recordEntry()`, `createOrder()` | payments, rules |
| Cancelled orders | No new payments. Refunds are allowed. Cancelling can refund everything paid in one entry (you choose) | `recordEntry()`, `setStatus()` | payments |
| Receipts | **Every** payment gets a numbered receipt and every refund a numbered refund receipt, per branch: `RCPT-[code-]YYYY-NNNNNN` / `RFND-…` (year of the receipt date, lifetime sequence, as for invoices). Shop, customer and the split across orders are stored when it's issued, so reprints never change. Entries recorded before receipts existed get one on request ("Get receipt"), once | `issueReceipt()`, `addEntry()`, `receiptForEntry()` | receipts |
| Settle dues | One payment from a customer settles their unpaid orders **oldest first** (order date, then order number); cancelled orders and other customers are never touched. The split is previewed first, can't exceed the total due, is saved in one transaction with **one receipt** and the same reference on every allocation, and a retried request returns the first receipt | `settleDues()` | receipts |
| Retries | A retried payment, settlement or return with the same key is recognised even if it waited for the first one's lock | `recordEntry()`, `settleDues()`, `createReturn()` | receipts, returns |
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
| After a return | The order **can't be edited, cancelled or deleted** (the return refers to the items as sold). Open ↔ Completed still works; more returns can follow |
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

**Share links:** "Send invoice" makes one private link per invoice revision that opens that invoice's PDF without a login. **Reset link** replaces it, so every link sent before stops working (`resetShareToken()`; test: invoices). Links don't expire on their own.

### Returns (internal return adjustment, `RTN-[code-]YYYY-NNNNNN`)

| Rule | Detail |
|---|---|
| What | Any quantity of any line, up to what was sold minus earlier returns. Not on cancelled orders. Date: today or earlier, not before the order date |
| Value | Each line: `quantity × unit price` (half-up) minus its share of the order discount (`× discount ÷ subtotal`, half-up). When everything left comes back, the return takes exactly the remaining total, so no paisa is left behind |
| Order | Its total goes down by the value (`returned_paise`); items, invoices and invoice snapshots are **never** changed, and the invoice is **not** marked "Needs reissue" |
| Money | The return first reduces what's owed. Only what's been paid beyond the new total is refunded: to the methods the customer paid with, newest payment first (or a method you choose). No store credit or wallet |
| Stock | **Saleable** items of stock-tracked products go back as a `return` movement; **damaged** items are recorded on the return and stay out of stock |
| Not a credit note | It's an internal document. No GST credit-note claim until the accountant approves tax rules |

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
| Total sales | Sum of order totals, **net of returns** | Order date, in the window |
| Total orders | Number of orders | Order date |
| Average bill value | Total sales ÷ total orders, same window | Order date |
| Collection rate | Paid on those orders ÷ their sales | Order date |
| Payments pending (analytics) | Balance due on the window's orders | Order date |
| **Payments received** | Payments − refunds entered **on that date**, on any order (including older ones). Removed entries are excluded | **Payment date** |
| Payment collection status | Orders and amount due per payment status, in the window | Order date |
| Highest-spending customers | Sum of order totals per customer (walk-ins excluded), top 5 | Order date |
| Best-selling items | Sum of **line amounts** per item name, before the order-level discount, **less returned items at their line value**, top 5 | Order date |
| Active customers | Distinct customers with an order in the last 60 days | Order date |
| Repeat rate | Customers with 2+ orders ÷ customers with 1+ | All time |
| Visit gap | Average days between a customer's consecutive orders | All time |
| Invoiced · 30d | Sum of issued invoices' totals | Invoice date |
| Due on invoices | Live balance due of orders that have an issued invoice | Now |
| **Outstanding & ageing** (report) | Every non-cancelled order with a balance above zero. Age = today − order date (there are no due dates; a future-dated order is 0 days). Buckets 0–30, 31–60, 61–90, 90+ days. By customer (walk-ins grouped) or by order | As of today; the date filter is on the order date |
| **Collections** (report) | Received, refunded and net per payment date and method, from the ledger (removed entries excluded). Each entry counts once on its own date, so a settlement split over orders adds up to what was collected | Payment date (default the last 30 days; at most 366) |
| 10 pm summary | Orders, sales, payments and new customers **entered** between 10 pm yesterday and 10 pm today (late entries roll into the next summary) | Entry time |

- Comparisons use the previous window of the same length. When that window is empty, the change shows "no prior data" instead of a percentage.
- Proven against a hand-calculated fixture and against the order list: `analytics.test.ts`. Also checked against independent SQL on a 388-order shop (see `CRM_TEST_RESULTS.md`).
- **No profit is calculated anywhere.** Cost price is reference only, and refunds, returns and expenses aren't modelled for profit.

## 6. Stock (products that track stock)

| Rule | Detail |
|---|---|
| Level | The sum of the product's stock movements, never a number someone types over |
| Orders | Take stock when saved. Edits post the difference; cancel puts it back; reopen takes it again; deleting an order (or a customer with their orders) puts it back |
| Returns | Saleable returned items come back as a `return` movement; damaged ones don't change stock |
| Not enough stock | The whole order is refused with exactly what's short. The "Allow selling when stock runs out" setting lets it go below zero (shown red / low) |
| Concurrency | Product rows are locked in a fixed order: two sales of the last unit, exactly one succeeds |
| Low stock | At or below the product's warning level, or below zero |
| History | Past orders keep their own item name and price; editing or archiving a product changes nothing in the past |

## 6a. Product catalogue (shareable link)

| Rule | Detail |
|---|---|
| One per branch | Each branch has its own catalogue of its own products. Owners create it, change it, reset or turn off the link; staff can share an existing link |
| Live | The link always shows current active products and prices; there is nothing to regenerate. Archived products never show |
| What customers see | Name, code (SKU), category, unit and price (or “Price on request” if prices are hidden). Never cost price, stock quantities, GSTIN or anything else in the shop |
| Out of stock | Hidden by default (tracked products at zero or below). If shown, marked “Out of stock”. Products without stock tracking always show |
| Stores | This branch's address and phone, plus the other branches run by the same owner(s) that have an address, city or phone. Can be switched off |
| Link | Random token; anyone holding it can view. Reset gives a new link and the old one stops; turning it off stops it until turned on again (with a new link). Not indexed by search engines |
| Size | Up to 2,000 products are shown |
| Designs | One design (Classic) for now; the design is stored per catalogue so more can be added |

## 6b. Tables, QR ordering and the kitchen screen (dine-in)

| Rule | Detail |
|---|---|
| Floors | A branch has one or more floors (e.g. Ground floor, Rooftop), each with its own size, tables and blocks (walls, counter, kitchen, entrance, windows, plants, areas, text). Owners draw, save and lock the whole plan; while locked nothing can be changed. Floor names and table names are unique across the branch |
| QR codes | Each table has a random token. Moving, renaming or moving it to another floor keeps it. "Replace QR code" issues a new one and the printed old one stops. Removing a table (or its floor) stops its QR; past orders keep the table name |
| Guest sign-in | Name, mobile (10-digit Indian) and email are required. A 6-digit code is emailed (works 10 minutes, 5 tries; one code per email every 30 seconds, 5 per 10 minutes; 10 per address). Only after the code is confirmed does the menu open. The session lasts 12 hours on that phone |
| Customer record | The guest is linked to the branch's customer with that mobile number, or a new customer is created (name, mobile, email). An existing customer's saved name and email are never changed; the verified email is kept on the session and used for the bill |
| First-order discount | 15% off the subtotal (rounded to the paisa) when the guest has no earlier order (other than cancelled) at this branch under that mobile number or email. Shown as a welcome message after confirming the email, applied to their first order only (claimed once, even with two quick orders), and printed on the order and bill as the order discount |
| Guest menu | Active products that can be sold now (in stock, or not stock-tracked), with price. Never cost or stock levels |
| Guest order | An ordinary order under the guest's customer record: prices come from the product list (never from the phone), stock is taken, numbering as usual. Marked with the table, guest name and note, and sent to the kitchen as New. Placed orders can't be changed by the guest; they can place more orders, and see their earlier ones (read-only) on the menu. Limits: 50 lines, 50 of each, 20 orders per table and 30 per address in 10 minutes; retries of the same submission return the same order |
| Payment (test) | No payment gateway yet. "I have paid" records the full amount as a UPI payment (with a receipt). Otherwise staff mark it paid from Live tables, choosing the method |
| Kitchen | New → Preparing → Ready → Served, and back one step to undo. Shows unserved orders oldest first (with floor and table), plus 30 minutes of served ones. Cancelled orders disappear |
| Done and bill | Served **and** fully paid → the order is completed, its invoice issued and a link to the bill PDF emailed to the guest (once; retried on the next completion if sending failed). The guest's order page then offers Download and a WhatsApp share. Automatic WhatsApp sending needs a WhatsApp Business API provider and isn't connected |
| Guest tracking | The guest's own link shows that one order's progress, items, discount, payment and bill, and nothing else |

## 6c. Table reservations

All booking times are India time (+05:30).

| Rule | Detail |
|---|---|
| Holding a table | A booking holds its tables from its start time for the "table held for" length (default 1 h 30 min) while it is Booked or Seated. Two such bookings can never share a table at overlapping times; back-to-back is fine. Checked on the server, one booking change at a time per branch |
| Staff bookings | Anyone in the branch can book (name, 10-digit mobile, party size, date, time and length required; email and note optional). Tables are optional: with none picked, the smallest free table that seats the party is given; if none fits, the booking is kept without a table to be given one later. Several tables can be picked for a big group (a warning shows if they seat fewer people). The guest is linked to the branch's customer with that mobile number (their saved details are kept), or a new customer is created |
| Statuses | Booked → Seated → Finished, or Booked → Cancelled / No-show. Seated can go back to Booked (a mistaken tap). Finishing early frees the table from that moment. Finished, cancelled and no-show bookings can't be changed |
| Emails | With an email, the guest is sent a confirmation (with a link to see or cancel), an update when staff move the time, and a note when staff cancel. Sent in the background with the existing mail setup |
| Online booking | Off until an owner turns it on, which creates a link (and QR code). Owners set opening and closing times, closed days, how often times are offered (15, 30 or 60 min), how long a table is held, the largest group, how many days ahead and how early guests must book. Times run from opening until the last one that ends by closing. "New link" stops the old one; "Turn off" stops booking online |
| Booking online | The guest picks party size, day and time; only times with a free table that seats the whole party are offered (one table per online booking; the largest table caps the party size). Bookings without a table count against the free tables. Name, mobile and email are required and the email is confirmed with the same 6-digit code as table ordering. The table is given at the moment of confirming; if the time was taken meanwhile nothing is saved and the code still works for another time. One email can't hold two bookings at overlapping times or more than 3 upcoming online bookings |
| Choosing a table online | After picking a time, the guest sees the floor plan (every floor) for that time: free tables that seat the party are green and can be tapped; booked ones show as Booked and too-small ones are greyed. It refreshes every 10 seconds; if someone else books the picked table first, it is unpicked with a note. Picking is optional (skip = the smallest free table). The table is checked again when confirming; if it was just taken, nothing is saved and the guest picks again. Only the drawing goes out, never QR codes or other guests' details |
| Guest's booking page | Shows the shop, date, time, party size, note and status, and nothing else. The guest can cancel it until its start time |
| Live tables | A table with no open orders shows as Reserved when a booking on it starts within 2 hours (or is up to an hour late), or its party is seated. Staff can seat the party, mark a no-show once the time has passed, or free the table when they leave |

## 7. Input validation (server-side; the browser repeats it for quick feedback)

| Field | Rule |
|---|---|
| Customer name | Required, up to 120 characters |
| Shop / branch phone | Optional. 6–15 digits; may contain `+`, spaces, brackets and dashes (landline, mobile or toll-free) |
| CSV import (customers, products) | Up to 1,000 rows. Every row passes the same rules as the Add form. A row with the ID of one of your records **updates** it; a row without an ID **creates** one. Unknown or other shops' IDs, and phone / product name / SKU clashes (also within the file), reject that row only. Product updates never change stock. A preview checks everything and saves nothing (test: import) |
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
| 011, 012 | None. New tables and columns only; every order has `returned_paise = 0`, so its total is unchanged. Older payments have no receipt until one is asked for |

Each migration was rehearsed on a copy of the local data before release.
