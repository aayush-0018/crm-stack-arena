---
marp: true
title: CartWell — Product Demo
paginate: true
---

# CartWell

### Billing, customers, invoices and insights — built for local shops

Customers → Orders → Invoices → WhatsApp → Daily summary, in one simple app that works on a laptop at the counter and on the owner's phone.

<!-- Speaker note: Open with the problem — most local shops run on paper, memory and WhatsApp. This replaces the khata, the bill book and the end-of-day tally in one place. -->

---

## The problem we solve

- [x] Bills written by hand, totals added on a calculator — mistakes and disputes
- [x] No record of **who buys what, and how often**
- [x] Pending payments tracked in memory or a notebook
- [x] No idea which days, hours, items or customers make the money
- [x] Regular customers quietly stop coming, and nobody notices
- [x] Several branches, but no single place to see each one

**CartWell fixes all six — without changing how the shop works.**

---

## What's inside — at a glance

| Area | What the owner gets |
|---|---|
| **Customers** | One record per customer, status tags, history, dues, WhatsApp in one tap |
| **Orders** | Fast billing with exact totals, discounts, part-payments |
| **Invoices** | Professional PDF invoices with your logo, sent on WhatsApp or email |
| **Dashboard & analytics** | Sales, collections, trends, top items and top customers |
| **Daily summary** | Every night at 10 pm: today's numbers in one screen |
| **Branches** | Run several shops from one login, each with its own data |
| **Privacy & control** | Hide numbers from customers, owner-only deletes, secure logins |

---

<!-- _class: section -->

# 1 · Getting started

---

## Sign-up and login

- [x] Create a shop account in under a minute: shop name, owner name, email, password
- [x] **Upload the shop logo at sign-up** — or add it later in Settings
- [x] Any image works (PNG, JPG, WebP, SVG); it's resized automatically
- [x] Secure login; passwords are encrypted, never stored readable
- [x] Stays signed in on your devices until you log out
- [x] Opens the branch you used last

**Demo:** Register → upload logo → land on Settings → logo appears in the menu.

---

## Forgot password — self-service

- [x] **"Forgot password?"** on the login page
- [x] A reset link arrives by email, branded with the shop name
- [x] Link works **once** and expires in **30 minutes**
- [x] Choosing a new password signs you straight in
- [x] **Every other device is signed out automatically** — a lost phone is locked out
- [x] The form never reveals whether an email is registered (no account snooping)
- [x] Built-in protection against repeated requests

**Demo:** Log in → Forgot password → email → new password → back in the app.

---

## Shop settings — what prints on your invoices

- [x] Shop name, address (2 lines), city, state, pincode
- [x] Phone, email, **GSTIN**
- [x] **Logo** — change or remove anytime
- [x] **Branch code** (e.g. `JPR`) so every branch has its own invoice series
- [x] Changes apply to **new** invoices; already-issued invoices never change

---

<!-- _class: section -->

# 2 · Customers

---

## Every customer, organised automatically

- [x] Add a customer with name, phone, email, address, notes
- [x] Phone numbers cleaned automatically (`+91 98765 43210` → `9876543210`)
- [x] **No duplicates** — the app warns if the phone already exists and links to that customer
- [x] Every customer gets a **status, calculated from their buying**:

| Status | Meaning |
|---|---|
| **New** | Joined or first ordered in the last 30 days |
| **Active** | Buying regularly |
| **VIP** | Top 10% by spend in the last 6 months |
| **Forgotten** | No order in 60+ days — time to win them back |

---

## Customer list — find anyone in seconds

- [x] Tabs: **All · Active · New · VIP · Forgotten**, each with a count
- [x] Headline numbers: total customers, active %, forgotten %, **average days between visits**, **repeat rate**
- [x] Search by name or phone
- [x] Sort by name, newest, last order, total spent, number of orders
- [x] Choose which columns to show (remembered)
- [x] Select rows → **Export to Excel (CSV)** or **Delete**
- [x] **Hover a name** → a quick card: status, phone, email, address, orders, total spent, last visit

**Demo:** Open VIP tab → hover a customer → card appears.

---

## One-tap WhatsApp messages

From the customer card, profile page or order page:

- [x] **Message** → write or pick a ready template:
  - Payment reminder (fills in the exact amount due)
  - Thank you
  - Fresh stock has arrived
  - We miss you
- [x] **Send** opens WhatsApp on that customer's number with the text filled in
- [x] Sent from the owner's own WhatsApp — no extra cost, no setup

---

## Customer profile

- [x] Orders, total spent, average order, **outstanding dues**, last visit
- [x] Full order history with payment status
- [x] Contact details and notes
- [x] Message box with templates
- [x] **New order** for this customer in one click
- [x] Edit details
- [x] Delete safely:
  - Default: **archive** — hidden from lists, history and invoices kept
  - Optional: **delete everything** — customer, all orders and invoices, permanently

---

<!-- _class: section -->

# 3 · Orders & billing

---

## Create an order — fast and exact

- [x] Pick an existing customer by name/phone, **or add a new one right inside the order**
- [x] Add items: name, **quantity (decimals allowed — 2.5 kg)**, price
- [x] Press Enter on the last price to add the next row
- [x] Live totals while typing: subtotal, discount, total, paid, balance
- [x] **Part-payments** supported; "Full" fills the amount in one tap
- [x] Order date and notes
- [x] **Totals are recalculated by the server** — no calculator errors, no tampering
- [x] Money stored to the paisa — no rounding errors, ever
- [x] **Double-click safe** — a slow network can never create the same order twice

**Demo:** New order → add customer inline → 3 items → save.

---

## Order numbers and branches

- [x] Automatic, gap-free numbering per branch: `ORD-000123`
- [x] With a branch code: `ORD-JPR-000123`, `INV-JPR-2026-000045`
- [x] Two branches can never print the same invoice number

---

## Order page — everything about one sale

- [x] Total, paid (with % gauge), balance due, items, date
- [x] Item table and totals
- [x] Customer details + **Message** on WhatsApp
- [x] **Order status** (Open · Completed · Cancelled) and **payment status** (Unpaid · Partial · Paid) tracked **separately**
- [x] **Record payment** — the payment status updates itself
- [x] **Edit** the order — the app warns if an invoice was already issued
- [x] **Cancel** — its invoice is automatically marked void
- [x] **Delete** (owner only) — order, items and all its invoices

---

## Orders list

- [x] Tabs: **All · Open · Completed · Cancelled**
- [x] Headline numbers: orders today, sales today, open orders, payment pending, cancelled (30 days)
- [x] Filter by payment status and date range
- [x] Search by order number, customer name or phone
- [x] Sort by date, total, order number
- [x] Choose columns, export to CSV, bulk delete
- [x] Hover a customer name for their quick card

---

<!-- _class: section -->

# 4 · Invoices

---

## Professional invoices in one click

- [x] **Generate invoice** from any order
- [x] Shows shop logo, address, GSTIN, invoice & order numbers, dates, customer, items, totals, amount paid, balance, payment status
- [x] **Print** with a clean A4 layout
- [x] **Download PDF** — logo included, well-spaced rows, multi-page for long bills
- [x] Clicking "Generate" twice never creates two invoices

**Demo:** Order → Generate invoice → Print preview → Download PDF.

---

## Invoices that never change behind your back

- [x] An invoice is a **frozen copy** of the order at the moment it was issued
- [x] Edit the order later → the invoice is flagged **"Needs reissue"**
- [x] **Reissue** → creates **Rev 2** with the same number; the old one is marked **Superseded**
- [x] Cancel the order → its invoice becomes **Void**
- [x] Changing the logo or address later doesn't alter old invoices

*Your records always match what the customer actually received.*

---

## Send the invoice to the customer

- [x] **Send on WhatsApp** — message with amount, balance and a PDF link, ready to send
- [x] **Send by email** — opens your mail app with everything filled in
- [x] **Share PDF file** — on phones, sends the actual PDF to any app
- [x] **Copy link** — a private link that opens only this one invoice
- [x] Links can't be guessed and give access to nothing else
- [x] **Sent log** on every invoice: how and when it went out
- [x] Void or superseded invoices can't be sent by mistake

---

## Invoices list

- [x] Tabs: **All · Issued · Superseded · Void**
- [x] Headline numbers: invoiced (30 days), invoice count, **due on invoices**, **needs reissue**, superseded/void
- [x] Search by invoice number, order, customer or phone
- [x] Status badges: Issued · Needs reissue · Superseded · Void
- [x] Export to CSV, bulk delete (owner only)
- [x] Menu badge shows how many invoices need reissuing

---

<!-- _class: section -->

# 5 · Insights

---

## Dashboard — the shop at a glance

- [x] **Revenue (30 days)** with change vs the previous 30 days
- [x] **Orders (30 days)** with change
- [x] **Average order value** (7-day rolling trend)
- [x] **Collection rate** — how much of sales is actually collected (90% target marker)
- [x] **Active customers** and their share
- [x] **Recent orders**
- [x] **Customers to win back** — high spenders who've gone quiet
- [x] **Oldest unpaid orders** — who to chase first
- [x] Badges in the menu: open orders, invoices needing reissue

---

## Analytics and reports

- [x] Periods: **last 7 · 30 · 90 · 180 days**
- [x] Revenue, orders, average order, collected, outstanding — each vs the previous period
- [x] **Daily revenue / orders chart** — hover any day for exact numbers
- [x] **"Show as table"** for the exact daily figures
- [x] **Payment status** breakdown: paid, partial, unpaid, with amounts due
- [x] **Order status** counts
- [x] **Top 5 customers** and **top 5 items** by revenue

---

## 🔔 Daily summary — every night at 10 pm

At 10 pm, the bell lights up. One tap opens the day's report:

- [x] **Sales** — big, with ▲/▼ vs the day before
- [x] Orders · Collected (% of sales) · Still due · Items sold
- [x] New customers · Invoices issued · Invoices sent · Cancelled orders
- [x] **Busiest hour** of the day
- [x] **Top 3 items** and the **best customer**
- [x] Outstanding across the shop, with a link to unpaid orders
- [x] Arrives on its own if the app is open at 10 pm; otherwise waiting next time
- [x] Late-night bills roll into the next day — nothing is missed
- [x] Kept privately on the device; replaced by the next night's summary

---

<!-- _class: section -->

# 6 · Branches, privacy & control

---

## Multiple branches, one login

- [x] **Add a branch** from the menu: name, code, city, phone
- [x] **Switch branches** from the shop name at the top of the menu
- [x] Each branch has **completely separate** customers, orders, invoices, numbering and reports
- [x] Each branch can have its own logo (new branches start with the current one)
- [x] Branch code keeps invoice series unique
- [x] Two tabs on two branches stay signed in at the same time
- [x] Only owners can add branches

**Demo:** Shop menu → Add branch → it opens empty → switch back in one click.

---

## Privacy at the counter

- [x] **👁 Hide numbers** — one tap masks all headline figures as `••••`
- [x] Works on every page and in the daily summary; remembered after reload
- [x] **Collapse** the summary strip when you need more room
- [x] Hide or show the **side menu** in one click (or `Ctrl/⌘ + B`)

*Customers at the counter never see your sales.*

---

## Safety and control

- [x] **Only owners can delete** customers, orders and invoices
- [x] Every delete asks for confirmation and explains exactly what goes
- [x] Customers with history are archived by default, not destroyed
- [x] Each shop and branch can only ever see its own data
- [x] Encrypted passwords; reset links are single-use, short-lived and stored scrambled
- [x] Password reset signs out all other devices
- [x] Clear messages for every error, with a Retry where it helps

---

## Works everywhere

- [x] Laptop at the counter, tablet, and phone
- [x] Phone layout: menu opens with ☰ and closes with one tap
- [x] Tables turn into tidy lists on small screens
- [x] Fast, clean, modern interface
- [x] Nothing to install — opens in any browser

---

<!-- _class: section -->

# 7 · Under the hood

---

## Built on a solid, modern stack

| Layer | Technology |
|---|---|
| App | React + TypeScript, Tailwind CSS |
| Server | Node.js + Express + TypeScript |
| Database | PostgreSQL |
| Security | JWT sessions + bcrypt password hashing, input validation on every request |
| Invoices | Server-generated PDFs |
| Email | Transactional email API (Brevo) |

- [x] Money stored in paise — exact to the last rupee
- [x] Every change to an order is checked and totalled on the server
- [x] Database changes are versioned, so upgrades are safe

---

## Hosting options

| Option | Monthly cost | Best for |
|---|---|---|
| **Free cloud** (Vercel + Render + Supabase) | ₹0 | Demos and trials — first visit after a quiet spell takes ~1 minute to wake up |
| **Paid cloud** (Render paid plan) | ~$7 (~₹600) | Always instant, no waiting |
| **Own server** (e.g. a small VPS) | ~₹400–500 | Full control, India region, own backups |
| **On the shop's computer** | ₹0 | Single shop, data never leaves the premises |

*We recommend a paid always-on plan for daily billing.*

---

<!-- _class: section -->

# 8 · What's next

---

## Roadmap — available on request

**Billing & money**
- [ ] GST invoicing — HSN codes, CGST/SGST/IGST, tax summary
- [ ] UPI QR code on every invoice
- [ ] Udhaar / khata book with payment history
- [ ] Thermal-printer receipts (58/80 mm)

**Stock**
- [ ] Product catalogue with barcode scanning
- [ ] Stock levels, low-stock alerts, reorder suggestions

**Growth**
- [ ] "Running low" refill reminders on WhatsApp
- [ ] Festival calendar and last-year comparisons
- [ ] Referral codes and loyalty points
- [ ] Busy vs quiet hours heatmap with quiet-hour offers

**Team**
- [ ] Staff accounts with limited permissions
- [ ] Activity log, backups from Settings, Hindi and regional languages

---

## Live demo — checklist

Run through in this order (about 15 minutes):

1. [ ] Sign up a shop **with a logo**
2. [ ] Fill shop details and a **branch code** in Settings
3. [ ] Add a customer — try a duplicate phone to show the warning
4. [ ] Create an order with **2.5 kg** of an item, a discount and a part-payment
5. [ ] **Generate invoice** → Print → **Download PDF** (logo on it)
6. [ ] **Send to customer** → WhatsApp message with the PDF link
7. [ ] **Record payment** → status changes to Paid
8. [ ] **Edit** the order → "Needs reissue" → **Reissue** as Rev 2
9. [ ] Customers → **VIP / Forgotten** tabs → hover card → **Message**
10. [ ] **Dashboard** → win-back list and unpaid orders
11. [ ] **Analytics** → switch 7 / 30 / 90 / 180 days, hover the chart
12. [ ] 🔔 **Daily summary**
13. [ ] 👁 **Hide numbers**
14. [ ] **Add a branch** → switch → empty data → switch back
15. [ ] Open it on a **phone**
16. [ ] Log out → **Forgot password** → reset by email

---

# Thank you

### CartWell — your counter, your customers, your numbers.

**Questions?**

[Your name] · [Phone] · [Email]
