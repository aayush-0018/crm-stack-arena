# Frontend Tech Plan

Derived from [../plan.md](../plan.md). Backend: [../backend/TECH_PLAN.md](../backend/TECH_PLAN.md). Schema: [../backend/DB_SCHEMA.md](../backend/DB_SCHEMA.md).

## Stack

| Concern | Choice |
|---|---|
| Build | Vite |
| UI library | React 18 + TypeScript (strict) |
| Styling | Tailwind CSS |
| Validation | Zod (same rules as backend) |
| Routing | `react-router-dom` (only extra dependency — needed for the page structure) |
| HTTP | Native `fetch` wrapper — no axios |
| State | React state + context — no Redux / React Query |

## Local-Only Rule

- Dev server at `http://localhost:5173`.
- Vite proxies `/api` → `http://127.0.0.1:4000`, so the app never calls any other host.
- No CDNs, analytics, external fonts or third-party scripts. Fonts are system fonts.

## Folder Structure

```
frontend/
  src/
    main.tsx
    App.tsx                    # router
    index.css                  # tailwind directives + print styles
    api/
      client.ts                # fetch wrapper: base '/api', bearer token, JSON, error parsing
      auth.ts customers.ts orders.ts invoices.ts dashboard.ts shop.ts
    types/                     # Customer, Order, OrderItem, Invoice, ApiError …
    schemas/                   # Zod schemas: customer, order, login
    lib/
      money.ts                 # paise <-> rupees, formatINR() via Intl 'en-IN'
      totals.ts                # live preview totals (display only; server is source of truth)
      date.ts                  # format in Asia/Kolkata
      uuid.ts                  # crypto.randomUUID() for idempotency keys
    context/
      AuthContext.tsx          # token, user, shop, login(), logout()
    components/
      layout/   AppShell, Sidebar, TopBar, ProtectedRoute
      ui/       Button, Input, Select, Textarea, Card, Badge, Modal, ConfirmDialog,
                Table, Pagination, Spinner, EmptyState, ErrorState, Toast
      customers/ CustomerForm, CustomerPicker
      orders/    LineItemsEditor, OrderTotals, StatusBadge, PaymentBadge, PaymentForm
      invoices/  InvoiceView
    pages/
      LoginPage, RegisterPage
      DashboardPage
      customers/ CustomerListPage, CustomerCreatePage, CustomerDetailPage, CustomerEditPage
      orders/    OrderListPage, OrderCreatePage, OrderDetailPage, OrderEditPage
      invoices/  InvoicePreviewPage
      SettingsPage             # shop details shown on invoice
      NotFoundPage
  index.html
  vite.config.ts
  tailwind.config.js
  postcss.config.js
  tsconfig.json
  package.json
```

## Routes

| Path | Page |
|---|---|
| `/login`, `/register` | Auth (public) |
| `/` | Dashboard |
| `/customers` | Customer list + search |
| `/customers/new` | Add customer |
| `/customers/:id` | Details + order history |
| `/customers/:id/edit` | Edit customer |
| `/orders` | Order list + filters |
| `/orders/new?customerId=` | Create order |
| `/orders/:id` | Order details, status, payment, invoice actions |
| `/orders/:id/edit` | Edit order |
| `/invoices/:id` | Invoice preview, Print / Save as PDF |
| `/settings` | Shop details |

All except login/register wrapped in `ProtectedRoute`.

## Navigation (matches plan.md)

Sidebar on desktop, bottom/hamburger nav on mobile:
Dashboard · Customers · Orders · Settings. Primary CTA "New Order" always visible.

## API Client

```ts
api.get<T>(path, query?) / api.post<T>(path, body) / api.put / api.patch / api.delete
```

- Prefix `/api` (no version segment).
- Adds `Authorization: Bearer <token>` from `localStorage`.
- Parses `{ error: { code, message, details } }` into a typed `ApiError`.
- On `401` → clear token, redirect to `/login`.
- Network failure → `ApiError('NETWORK_ERROR')` so screens can show retry.

## Auth

- Login/Register forms validated with Zod.
- Token stored in `localStorage`; `AuthContext` loads `/api/auth/me` on boot.
- Logout clears token and state.

## Page Behaviour

### Dashboard
- Four count cards from `/api/dashboard/summary`: customers, orders today, open orders, unpaid/partial orders.
- Quick actions: New Order, Add Customer. No charts.

### Customers
- **List:** debounced (300 ms) search box (name or phone), paginated table (name, phone, orders, created). Mobile → stacked cards.
- **Create/Edit:** `CustomerForm` (name*, phone*, email, address, notes). Zod inline errors; `409 PHONE_EXISTS` mapped to phone field with link to existing customer.
- **Detail:** info card, stats (orders, total, outstanding), order history table, actions: Edit, New Order, Delete.
- **Delete:** `ConfirmDialog`. If customer has orders, warn: "This customer has N orders. They will be archived and hidden, order history and invoices are kept." Toast reflects hard/soft result.

### Orders
- **Create:**
  1. `CustomerPicker` — search existing customers, or "Add new customer" inline form.
  2. `LineItemsEditor` — rows of item name, qty, unit, unit price, line total; add / remove / edit; keyboard friendly (Enter adds row).
  3. `OrderTotals` — live subtotal, discount, total, amount paid, balance (display only).
  4. Review → Save. Button disabled while submitting; one `idempotencyKey` generated per form session so a retry after a dropped connection doesn't duplicate the order.
  5. On success → toast "Order ORD-000123 saved" → `/orders/:id` with **Generate Invoice** prominent.
- **List:** filters for search (order no / customer), status, payment status, date range; paginated; filters kept in URL query.
- **Detail:** header (number, date, customer link), status + payment badges, items table, totals, actions: Edit, Change Status, Record Payment, Generate / View Invoice.
- **Edit:** same editor prefilled. If an invoice exists, banner: "An invoice was already issued. Saving changes will not change it; you can reissue afterwards."
- Status and payment are separate controls, matching the backend.

### Invoice
- **Generate:** `POST /api/orders/:id/invoice`.
  - Existing & unchanged → navigate to it.
  - `409 INVOICE_OUTDATED` → modal "Order changed after invoice INV-… was issued. Reissue as revision N?" → `?reissue=true`.
  - Failure → error state with **Retry**.
- **Preview (`InvoicePreviewPage`):** `InvoiceView` renders from the invoice snapshot (`/api/invoices/:id`) — shop, invoice no + revision, date, customer, items, totals, paid, balance, payment status. Superseded invoices show a "Superseded" watermark/banner.
- **Print:** `window.print()` with print CSS.
- **Save as PDF:** open `/api/invoices/:id/pdf` (fetched with auth as a Blob → object URL → download/open). Retry on failure.

## Print Styling

In `index.css`:

```css
@media print {
  @page { size: A4; margin: 12mm; }
  .no-print { display: none !important; }
  body { background: #fff; }
  thead { display: table-header-group; }   /* repeat header on long lists */
  tr { break-inside: avoid; }
}
```

Nav, buttons and banners get `no-print`. `InvoiceView` uses neutral black/gray Tailwind classes so it prints cleanly.

## Validation

`src/schemas/` mirrors backend rules: phone 10 digits (6–9 start, `+91`/spaces stripped), quantity > 0 with ≤ 3 decimals, price ≥ 0 with ≤ 2 decimals, ≥ 1 line item, amount paid ≤ total. Server errors still displayed per field (server is source of truth).

## UI States (every data screen)

| State | Component |
|---|---|
| Loading | `Spinner` / skeleton rows |
| Empty | `EmptyState` with CTA ("No customers yet — Add customer") |
| Error | `ErrorState` with message + Retry |
| Success | `Toast` |
| Submitting | Disabled buttons + inline spinner |

A small `useAsync` hook handles `loading / error / data / reload` for page fetches.

## Money & Formatting

- API returns paise integers; UI formats with `Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })`.
- Inputs accept rupees; sent as strings to avoid float drift.
- Dates shown as `DD MMM YYYY` in `Asia/Kolkata`.

## Responsiveness

Mobile-first Tailwind. Tables collapse to cards below `md`. Line item editor stacks fields on small screens. Touch targets ≥ 44 px.

## Scripts

```
npm run dev        # vite (localhost:5173, proxies /api)
npm run build      # tsc -b && vite build
npm run preview
npm run typecheck
```

## Build Order

1. Scaffold Vite + TS + Tailwind, proxy, router, AppShell, UI primitives.
2. API client + AuthContext + login/register.
3. Customers pages.
4. Orders pages (CustomerPicker, LineItemsEditor, totals, status/payment).
5. Invoice generate / preview / print / PDF.
6. Dashboard + Settings.
7. Manual pass over Phase 5 checklist in plan.md (empty lists, invalid inputs, server down, long invoices, mobile).
