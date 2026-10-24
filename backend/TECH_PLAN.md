# Backend Tech Plan

Derived from [../plan.md](../plan.md). Schema details: [DB_SCHEMA.md](DB_SCHEMA.md). Frontend: [../frontend/TECH_PLAN.md](../frontend/TECH_PLAN.md).

## Stack

| Concern | Choice |
|---|---|
| Runtime | Node.js 20 LTS |
| Framework | Express 4 + TypeScript (strict) |
| Database | PostgreSQL 16 (**local only**), raw SQL via `pg` — **no ORM** |
| Auth | JWT (`jsonwebtoken`) + `bcrypt` |
| Validation | Zod |
| PDF | pdfmake (server-side) |

Supporting packages (minimal, needed to wire the stack): `pg`, `jsonwebtoken`, `bcrypt`, `zod`, `pdfmake`, `cors`, `dotenv`. Dev: `typescript`, `tsx`, `@types/*`.

## Local-Only Rule

- `DATABASE_URL` points at `localhost`. The server binds to `127.0.0.1:4000`.
- No external APIs, hosted DBs, cloud services, or telemetry.
- CORS allows only `http://localhost:5173` (Vite dev server).

## API Naming

All routes live under **`/api`** — no version segment (no `/v1`).

## Folder Structure

```
backend/
  src/
    server.ts              # starts HTTP server
    app.ts                 # express app, middleware, routes
    config/env.ts          # Zod-validated env vars
    db/
      pool.ts              # pg Pool
      tx.ts                # withTransaction(fn) helper
    middleware/
      auth.ts              # verifies JWT, sets req.auth = { userId, shopId }
      validate.ts          # validate({ body, query, params }) with Zod
      errorHandler.ts      # maps errors -> JSON
    modules/
      auth/      { auth.routes.ts, auth.service.ts, auth.schemas.ts }
      shop/      { shop.routes.ts, shop.service.ts, shop.schemas.ts }
      customers/ { customers.routes.ts, customers.service.ts, customers.repo.ts, customers.schemas.ts }
      orders/    { orders.routes.ts, orders.service.ts, orders.repo.ts, orders.schemas.ts, totals.ts }
      invoices/  { invoices.routes.ts, invoices.service.ts, invoices.repo.ts, invoicePdf.ts }
      dashboard/ { dashboard.routes.ts }
    lib/
      errors.ts            # AppError(status, code, message, details?)
      money.ts             # paise helpers
      numbering.ts         # next order / invoice number (row lock)
  db/
    migrations/*.sql
    seed.sql
  scripts/
    migrate.ts             # applies unapplied migrations in order
  .env.example
  package.json
  tsconfig.json
```

Layering: **routes** (HTTP + Zod) → **service** (business rules, transactions) → **repo** (parameterised SQL only).

## Environment

```
PORT=4000
DATABASE_URL=postgres://crm:crm@localhost:5432/crm_dev
JWT_SECRET=<long random string>
JWT_EXPIRES_IN=7d
CORS_ORIGIN=http://localhost:5173
```

Validated at boot with Zod; process exits on invalid config.

## Scripts

```
npm run dev        # tsx watch src/server.ts
npm run build      # tsc
npm start          # node dist/server.js
npm run migrate    # tsx scripts/migrate.ts
npm run seed       # psql $DATABASE_URL -f db/seed.sql
npm run typecheck
```

## Database Access (no ORM)

- Single `pg.Pool`. All SQL uses `$1, $2…` parameters — never string concatenation.
- `withTransaction(async (client) => …)` wraps `BEGIN / COMMIT / ROLLBACK`.
- Repos return plain typed rows; `NUMERIC` quantity parsed from string, `BIGINT` paise parsed to `number` (safe for amounts < ₹90 trillion).
- Every repo function takes `shopId` as its first argument and includes `WHERE shop_id = $1`.

## Authentication

- `POST /api/auth/register` creates shop + owner user + `shop_counters` row in one transaction.
- Passwords hashed with bcrypt, cost 12.
- JWT payload: `{ sub: userId, shopId }`, HS256, 7-day expiry.
- Sent as `Authorization: Bearer <token>`.
- `auth` middleware protects every route except register/login. `shopId` always comes from the token — any `shop_id` in the body is ignored. This is what stops cross-shop access.

## Validation (Zod)

- Every route declares body/query/params schemas.
- Phone: strip spaces/`+91`, must be 10 digits starting 6–9.
- Money from client in **rupees as strings or numbers with ≤ 2 decimals** → converted to paise on the server.
- Quantity: > 0, ≤ 3 decimals, max 99,999.
- Line items: 1–200 per order.
- Validation errors → `400` with field-level details.

## Error Format

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Invalid input", "details": { "phone": "Enter a 10-digit mobile number" } } }
```

| Status | Code examples |
|---|---|
| 400 | `VALIDATION_ERROR` |
| 401 | `UNAUTHENTICATED` |
| 404 | `NOT_FOUND` (also returned for other shops' records) |
| 409 | `PHONE_EXISTS`, `INVOICE_OUTDATED`, `ORDER_CANCELLED` |
| 500 | `INTERNAL_ERROR`, `INVOICE_PDF_FAILED` |

Postgres unique violation (`23505`) is mapped to `409`.

## API Endpoints

### Auth
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/register` | Create shop + owner, returns token |
| POST | `/api/auth/login` | Email + password → token |
| GET | `/api/auth/me` | Current user + shop |

### Shop
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/shop` | Shop details (used on invoices) |
| PUT | `/api/shop` | Update shop details |

### Customers
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/customers?search=&page=&pageSize=` | List / search by name or phone |
| POST | `/api/customers` | Create |
| GET | `/api/customers/:id` | Details + order summary (count, total spent, outstanding) |
| PUT | `/api/customers/:id` | Update |
| DELETE | `/api/customers/:id` | Hard delete if no orders, else soft delete. Response says which. |
| GET | `/api/customers/:id/orders` | Order history |

### Orders
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/orders?search=&customerId=&status=&paymentStatus=&from=&to=&page=` | List / filter (search matches order number or customer name/phone) |
| POST | `/api/orders` | Create (with optional inline new customer) |
| GET | `/api/orders/:id` | Details + items + current invoice summary |
| PUT | `/api/orders/:id` | Edit items/discount/notes (not allowed when cancelled) |
| PATCH | `/api/orders/:id/status` | Change order status |
| PATCH | `/api/orders/:id/payment` | Set amount paid; payment status derived |

Create body:

```json
{
  "idempotencyKey": "uuid",
  "customerId": 12,
  "newCustomer": null,
  "items": [{ "itemName": "Rice 5kg", "quantity": "2", "unit": "pcs", "unitPrice": "320.00" }],
  "discount": "0",
  "amountPaid": "0",
  "notes": ""
}
```

Exactly one of `customerId` / `newCustomer` is required.

### Invoices
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/orders/:id/invoice` | Generate. Returns existing if order unchanged; `409 INVOICE_OUTDATED` if order changed and `reissue` not set |
| POST | `/api/orders/:id/invoice?reissue=true` | Supersede old, create new revision |
| GET | `/api/invoices/:id` | Invoice snapshot JSON (for on-screen preview) |
| GET | `/api/invoices/:id/pdf` | PDF stream, `Content-Disposition: inline; filename="INV-2026-000045.pdf"` |
| GET | `/api/orders/:id/invoices` | All revisions for an order |

### Dashboard
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/dashboard/summary` | Counts only: customers, orders today, open orders, unpaid/partial orders. No analytics. |

### Health
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | `{ ok: true }` + DB ping |

## Key Business Logic

### Order create (one transaction)
1. If `idempotencyKey` already exists for shop → return that order (`200`), don't create another.
2. If `newCustomer` → insert customer (409 on duplicate phone).
3. Verify `customerId` belongs to shop and is not deleted.
4. Lock `shop_counters` row, take `next_order_seq`, increment.
5. Compute totals in `totals.ts` (integer paise math — see DB_SCHEMA.md). Ignore any client totals.
6. Derive `payment_status`; reject `amountPaid > total`.
7. Insert order + items. Commit. Return full order.

### Order edit
- Load with `SELECT … FOR UPDATE`, reject if `cancelled`.
- Replace items, recompute totals, re-derive payment status, `version = version + 1`.
- Issued invoice is **not** touched. Response includes `invoiceOutdated: true` if one exists.

### Invoice generate (one transaction)
1. Lock order row. Reject if cancelled.
2. Find issued invoice for order.
   - Exists and `order_version` matches → return it.
   - Exists and differs → `409 INVOICE_OUTDATED` unless `reissue=true`; then mark `superseded` and continue with `revision + 1`, same number.
   - None → lock `shop_counters`, take `next_invoice_seq`.
3. Build snapshot JSON from current shop, customer, items, totals. Insert. Commit.
4. Partial unique index catches any race → re-read and return existing.

### Invoice PDF
- `invoicePdf.ts` builds a pdfmake doc definition **only from the snapshot row** — never live order data, so amounts always match what was issued.
- Contents: shop block, invoice number + revision, invoice date, customer block, items table (#, item, qty, unit, unit price, line total), subtotal, discount, total, amount paid, balance due, payment status, footer.
- Uses pdfmake's bundled Roboto font; `₹` rendered via a bundled font that supports it (fallback "Rs.").
- Table header repeats on each page for long item lists.
- Errors → `500 INVOICE_PDF_FAILED`; client can retry (GET is idempotent).

### Customer delete
- `SELECT count(*) FROM orders WHERE customer_id = $1` → 0: hard delete; > 0: set `deleted_at`.
- Response `{ deleted: "hard" | "soft" }`.

## Security Checklist

- Parameterised SQL everywhere.
- `shopId` only from JWT; cross-shop ids return 404.
- bcrypt for passwords; never return `password_hash`.
- `express.json({ limit: '100kb' })`.
- Generic login error ("Invalid email or password").
- No secrets in repo; `.env` gitignored, `.env.example` committed.

## Testing (Phase 5 support)

- Unit: `totals.ts` (fractional qty, rounding, discount, payment derivation), phone normaliser.
- Integration against a **local** `crm_test` database: customer CRUD + soft delete, order create/edit/idempotency, invoice generate/reuse/reissue/void, cross-shop isolation, PDF returns `application/pdf`.
- Runner: Node's built-in `node:test` via `tsx` (no extra dependency).

## Build Order

1. Scaffold project, env, pool, migrate script, migrations, seed.
2. Auth (register/login/me) + middleware + error handler.
3. Customers module.
4. Orders module + totals + numbering.
5. Invoices module + pdfmake.
6. Dashboard summary + health.
7. Integration tests.
