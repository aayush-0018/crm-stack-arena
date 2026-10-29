# Feature Ideas — CartWell

Ideas for what to build after the current version (customers → orders → invoices + dashboard analytics).
Each idea notes what it builds on in the current code, a rough **effort** (S = a day or two, M = about a week, L = several weeks) and **impact** for a local shop owner in India.

Items marked ⚠ need an outside service (WhatsApp, SMS, payment gateway, etc.); everything else can run fully locally.

---

## 1. Billing, tax & money

| # | Feature | What it does | Builds on | Effort | Impact |
|---|---|---|---|---|---|
| 1 | **GST invoicing** | HSN/SAC code and GST rate per line item; CGST/SGST vs IGST split by place of supply; tax summary on the invoice; "Tax Invoice" vs "Bill of Supply" by shop GST status. | `shops.gstin` already stored; `order_items`, invoice snapshots | L | High |
| 2 | **Payments ledger** | Record each payment separately (date, amount, mode: cash/UPI/card/credit) instead of one `amount_paid` number. Gives a full payment history and correct "collected per day". | `orders.amount_paid_paise`, `PATCH /orders/:id/payment` | M | High |
| 3 | **Udhaar / khata book** | A running credit balance per customer across all orders, with "settle dues" that spreads one payment over the oldest unpaid orders. | Payments ledger (#2), customer stats | M | High |
| 4 | **UPI QR on invoices** | Print a UPI QR code (`upi://pay?pa=…&am=…`) with the balance due on the invoice and PDF. Works offline: it's just a generated image. | Shop settings (add UPI ID), pdfmake supports QR | S | High |
| 5 | **Returns & credit notes** | Return some or all items from an invoiced order; issue a numbered credit note that links to the original invoice. | Invoice revisions/snapshots, numbering in `shop_counters` | M | Medium |
| 6 | **Line-item discounts & rounding** | Per-item discount (₹ or %), plus round-off to the nearest rupee shown as a separate line. | `computeTotals` in `orders/totals.ts` | S | Medium |
| 7 | **Expenses** | Log shop expenses (rent, electricity, supplier bills) by category, so the dashboard can show profit rather than only sales. | New table; dashboard analytics | M | Medium |
| 8 | **Day-end cash closing** | A daily summary of cash expected vs counted and UPI received, with any difference noted and the day locked. | Payments ledger (#2) | M | Medium |

## 2. Products & inventory

| # | Feature | What it does | Builds on | Effort | Impact |
|---|---|---|---|---|---|
| 9 | **Product catalogue** | Saved products with name, unit, default price, GST rate and barcode. The order form autocompletes from it instead of free text. | `order_items.item_name` (keep free text as a fallback) | M | High |
| 10 | **Stock tracking** | Stock levels go down when an order is saved and back up on cancel or return; a manual adjustment screen. | Catalogue (#9) | M | High |
| 11 | **Low-stock alerts** | Per-product reorder level; a dashboard tile and list of items to reorder. | Stock tracking (#10) | S | Medium |
| 12 | **Barcode scanning** | Add items by scanning with a USB scanner (acts as a keyboard) or the phone camera. | Catalogue (#9), `LineItemsEditor` | M | Medium |
| 13 | **Suppliers & purchases** | Supplier list, purchase entries that add stock, and purchase cost so margins can be calculated. | Stock (#10), Expenses (#7) | L | Medium |
| 14 | **Price lists** | Different prices for wholesale vs retail customers, or a festive price list that can be switched on. | Catalogue (#9), customers | M | Low |

## 3. Customers & relationships

| # | Feature | What it does | Builds on | Effort | Impact |
|---|---|---|---|---|---|
| 15 | **Customer tags & groups** | Tag customers (Regular, Wholesale, Society A) and filter or search by tag. | `customers` table, list filters | S | Medium |
| 16 | **Quick repeat order** | "Reorder" button on a past order or the customer page, which pre-fills the order form with the same items and current prices. | `OrderForm`, `orderToForm` | S | High |
| 17 | **Customer insights panel** | On the customer page: last visit, average spend, visit frequency, favourite items, days since last order. | Existing stats query | S | Medium |
| 18 | **Birthdays & anniversaries** | Store dates and show "This week" reminders on the dashboard (local-only reminders; sending messages is #24). | New customer fields | S | Low |
| 19 | **Loyalty points** | Earn points per ₹ spent and redeem them as a discount on an order; balance shown on the invoice. *(Was out of scope for the first version.)* | Discounts (#6), payments | M | Medium |
| 20 | **Duplicate customer merge** | Find likely duplicates (similar name, same address) and merge them, moving their orders to one customer. | Soft delete already exists | M | Low |

## 4. Sharing & communication

| # | Feature | What it does | Builds on | Effort | Impact |
|---|---|---|---|---|---|
| 21 | **Share invoice on WhatsApp (click-to-chat)** | A button that opens `wa.me/<phone>?text=…` with the invoice summary. No API or account needed: it uses the shop's own WhatsApp. | Invoice page, customer phone | S | High |
| 22 | **Thermal receipt printing** | A 58mm/80mm print layout for common Bluetooth/USB thermal printers, alongside the A4 invoice. | Print CSS, `InvoiceView` | S | High |
| 23 | **Payment reminders** | A list of customers with dues older than X days, each with a one-tap WhatsApp reminder (click-to-chat, as in #21). | Outstanding stats, #21 | S | High |
| 24 | ⚠ **Automated SMS/WhatsApp messages** | Order confirmations, dues reminders and festive wishes sent through the WhatsApp Business API or an SMS gateway. *(Campaigns were out of scope for the first version.)* | #21, #23 | L | Medium |
| 25 | **Public invoice link** | A signed, read-only URL for an invoice that the customer can open without logging in. Needs the app to be reachable beyond localhost once deployed. | Invoice snapshots | M | Medium |

## 5. Analytics & reports

| # | Feature | What it does | Builds on | Effort | Impact |
|---|---|---|---|---|---|
| 26 | **Peak hours & days heatmap** | A weekday × hour grid of orders, to see busy and idle times. *(This was the planned V2 analytics.)* | `orders.created_at`, analytics endpoint | S | Medium |
| 27 | **Monthly sales & GST reports** | Month-wise sales, tax collected, and a GSTR-1-style summary, exportable as CSV/Excel. | GST (#1), analytics | M | High |
| 28 | **Customer retention view** | New vs returning customers per month, and a "lapsed customers" list (no order in 60 days) to win back. | Orders by customer | M | Medium |
| 29 | **Item-level profit** | Margin per product and per order, using purchase cost. | Purchases (#13) | M | Medium |
| 30 | **CSV export everywhere** | Download customers, orders, invoices and analytics tables as CSV. | List endpoints | S | Medium |
| 31 | **Custom date range & comparisons** | Pick any date range on the dashboard and compare it with the same period last year. | `/dashboard/analytics?days=` | S | Low |

## 6. Team, security & operations

| # | Feature | What it does | Builds on | Effort | Impact |
|---|---|---|---|---|---|
| 32 | **Staff accounts & roles** | Owner invites staff; staff can bill but not delete, see reports, or change settings. | `users.role` already has `owner`/`staff` | M | High |
| 33 | **Activity / audit log** | Who created, edited, cancelled or reissued what, and when, shown on the order page. | All write services | M | Medium |
| 34 | **Multiple branches** | One owner, several shops/counters, with a branch switcher and combined reports. | `shop_id` scoping everywhere | L | Medium |
| 35 | **Backups** | One-click `pg_dump` download and restore from Settings, plus an optional scheduled local backup. | Local Postgres | S | High |
| 36 | **Password reset & session management** | Change password, log out other devices, set token expiry. ⚠ Email reset links need a mail service; an owner-run reset for staff does not. | Auth module | S | Medium |
| 37 | **Data import** | Import customers (and opening balances) from CSV/Excel, for shops moving off paper or another app. | Customer create service, validation | M | High |

## 7. Experience & platform

| # | Feature | What it does | Builds on | Effort | Impact |
|---|---|---|---|---|---|
| 38 | **Installable app & offline billing** | A PWA that can be added to the home screen and keeps taking orders without internet, syncing later (orders already carry an idempotency key, which makes the sync safe). | `idempotency_key` on orders | L | High |
| 39 | **Hindi & regional languages** | Translate the UI and invoices into Hindi, Marathi, Tamil and others; print the shop name in the local script. | All UI text, pdfmake fonts | M | High |
| 40 | **Dark mode** | Theme toggle; chart colours already come from CSS tokens. | `index.css` chart tokens | S | Low |
| 41 | **Keyboard-first billing** | Shortcuts: `N` for a new order, `/` to search, `Ctrl+Enter` to save, item autocomplete. | `LineItemsEditor` | S | Medium |
| 42 | **Invoice templates** | Choose a layout, add a logo, terms & conditions, bank details and a signature. | `invoicePdf.ts`, shop settings | M | Medium |
| 43 | **Global search** | One search box that finds customers, orders and invoices by number, name or phone. | Existing list queries | S | Medium |

---

## Suggested next steps

If the goal is making the app useful day-to-day for a kirana or general store, a good first batch is:

1. **#21 Share on WhatsApp** + **#22 Thermal receipts**: small, and they cover how bills actually reach customers.
2. **#4 UPI QR** on invoices: helps collect dues faster.
3. **#2 Payments ledger → #3 Khata book**: credit tracking is the core habit for these shops.
4. **#9 Product catalogue** + **#16 Quick reorder**: makes billing much faster.
5. **#1 GST invoicing**: required for GST-registered shops; larger, so plan it as its own project.
6. **#35 Backups**: cheap insurance now that real data is stored locally.
