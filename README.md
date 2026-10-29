# CartWell

Customers → Orders → Invoices for local shops. Everything runs locally.

- `backend/` — Express + TypeScript + PostgreSQL (raw SQL via `pg`, no ORM). Plan: [backend/TECH_PLAN.md](backend/TECH_PLAN.md), schema: [backend/DB_SCHEMA.md](backend/DB_SCHEMA.md)
- `frontend/` — React + Vite + TypeScript + Tailwind. Plan: [frontend/TECH_PLAN.md](frontend/TECH_PLAN.md)

API lives under `/api` (no version prefix).

## 1. Local database (PostgreSQL 16)

```bash
brew install postgresql@16 && brew services start postgresql@16   # if not installed

psql postgres -c "CREATE ROLE crm WITH LOGIN PASSWORD 'crm';"
psql postgres -c "CREATE DATABASE crm_dev OWNER crm;"
```

## 2. Backend

```bash
cd backend
npm install
# .env is already created (local DB, random JWT secret). Edit DATABASE_URL if your credentials differ.
npm run migrate     # applies db/migrations/001_init.sql
npm run dev         # http://127.0.0.1:4000  (check: curl http://127.0.0.1:4000/api/health)
```

Alternative to `npm run migrate`: `psql postgres://crm:crm@localhost:5432/crm_dev -f db/migrations/001_init.sql`
(use one or the other, not both).

## 3. Frontend

```bash
cd frontend
npm install
npm run dev         # http://localhost:5173  (proxies /api to the backend)
```

## 4. End-to-end flow

1. Open http://localhost:5173 → **Create your shop** (registers shop + owner).
2. Fill shop details in **Settings** (printed on invoices).
3. **Customers → Add customer**.
4. **New order** → pick the customer (or add one inline) → add items → Save.
5. On the order page → **Generate invoice** → **Print** or **Save as PDF**.
6. Edit the order → the order page shows the invoice is outdated → **Reissue** creates Rev 2.
# crm-stack-arena
