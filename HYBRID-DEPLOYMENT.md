# D METRAN ERP — Hybrid Cloud Deployment

**Hybrid** means:

- **Cloud / office server:** Web UI, API, and PostgreSQL — users open ERP in Chrome/Edge from anywhere.
- **Each cashier PC:** Local thermal print bridge only (`start-print-server.bat` → `localhost:9999`).

Accounting, sales, HR, reports, and browser/PDF printing work fully online. POS thermal receipts still need the small print app on the register machine.

---

## Architecture

```
                    ┌─────────────────────────────┐
  Staff browsers ──►│  HTTPS (nginx / Caddy)      │
  (office, WFH)     │  erp.yourcompany.com        │
                    └──────────────┬──────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │  Express :5000              │
                    │  • /api/*  REST API         │
                    │  • /*      React SPA        │
                    │  • /uploads attachments     │
                    └──────────────┬──────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │  PostgreSQL                 │
                    └─────────────────────────────┘

  Cashier PC (per store)
  ┌─────────────────────────────────────────────┐
  │ Browser → https://erp.yourcompany.com/pos   │
  │ start-print-server.bat → localhost:9999     │
  │ Bluetooth thermal printer (COM port)        │
  └─────────────────────────────────────────────┘
```

---

## Option A — Docker (recommended for VPS / cloud)

### 1. Prepare environment

```bash
cp .env.docker.example .env
# Edit .env: JWT_SECRET, DB_PASSWORD, CORS_ORIGINS
```

### 2. Build and start

```bash
docker compose up -d --build
```

ERP listens on port **5000** (or `ERP_PORT` in `.env`).

### 3. HTTPS

Put **nginx** or **Caddy** in front. Example: `deploy/nginx.conf.example`.

Set in `backend/.env` or docker environment:

- `TRUST_PROXY=true`
- `CORS_ORIGINS=https://erp.yourcompany.com`

### 4. First login

Seed if needed: `docker compose exec erp sh -c "cd /app/backend && npx ts-node src/database/seed.ts"`  
(Or run seed once during initial setup.)

Change default `admin` / `admin123` immediately.

---

## Option B — Windows / Linux server (no Docker)

### 1. Install

- Node.js 20+
- PostgreSQL 14+

### 2. Configure

```bash
cp backend/.env.example backend/.env
# Edit: JWT_SECRET, DB_*, SERVE_FRONTEND=true, TRUST_PROXY=true, CORS_ORIGINS
```

### 3. Build and run

**Windows:** double-click `start-production.bat`

**Or manually:**

```bash
npm run build
cd backend && npm run migrate:prod && npm start
```

Users open `http://server-ip:5000` or your HTTPS domain.

---

## Cashier PCs (thermal printing)

On **each** POS/register computer:

1. Install Node.js (one-time).
2. Copy the project folder **or** at minimum:
   - `start-print-server.bat`
   - `thermal-print-server/` folder
3. Double-click **`start-print-server.bat`** before opening POS.
4. Pair Bluetooth printer in Windows (appears as COM port).
5. In ERP: **Settings → Printer** — select COM port, test print.

The cashier browser loads ERP from the cloud URL. Print requests go to `localhost:9999` on that PC only.

Optional desktop shortcut:

- Target: `start-print-server.bat`
- Start in: folder containing the script

---

## Development vs production

| | Development | Hybrid production |
|---|-------------|-------------------|
| Frontend | Vite `:5173` | Served by Express from `frontend/dist` |
| Backend | `:5000` | `:5000` behind HTTPS proxy |
| API URL | `/api` (Vite proxy) | `/api` (same origin) |
| Thermal print | `localhost:9999` on dev PC | `localhost:9999` on each cashier PC |
| Electron | Optional | Not needed |

Local dev unchanged:

```bash
npm run dev
```

---

## Security checklist

| Item | Action |
|------|--------|
| JWT_SECRET | Long random string — never `default-secret` |
| HTTPS | Required for internet access |
| TRUST_PROXY | `true` when behind nginx |
| CORS_ORIGINS | Your real domain(s) only |
| PostgreSQL | Not exposed to public internet |
| Backups | Daily `pg_dump` + test restore |
| Default admin password | Change before go-live |

See also: `GO-LIVE-CHECKLIST.md`

---

## Environment variables

| Variable | Purpose |
|----------|---------|
| `NODE_ENV` | `production` |
| `SERVE_FRONTEND` | `true` — serve React build from Express |
| `FRONTEND_DIST` | Path to `frontend/dist` (Docker sets this) |
| `TRUST_PROXY` | `true` behind reverse proxy |
| `CORS_ORIGINS` | Comma-separated allowed origins |
| `JWT_SECRET` | Session signing key |
| `DB_*` | PostgreSQL connection |

Cashier-only (optional):

| Variable | Purpose |
|----------|---------|
| `VITE_THERMAL_PRINT_SERVER` | Default `http://localhost:9999` — rarely change |

---

## Troubleshooting

**Blank page after deploy**  
Run `npm run build:frontend`. Ensure `SERVE_FRONTEND=true` and `frontend/dist` exists.

**Login works locally but not from domain**  
Check HTTPS, `CORS_ORIGINS`, and that nginx forwards `X-Forwarded-Proto`.

**POS sale works but no receipt**  
Print bridge must run on **that cashier PC**, not the server. Run `start-print-server.bat`.

**Uploads / logo missing after container restart**  
Use Docker volume `erp_uploads` or persistent disk for `uploads/`.

---

## Quick commands

```bash
# Production build + start (manual)
npm run build && npm run start:prod

# Docker
npm run docker:up
npm run docker:down

# Health check
curl https://erp.yourcompany.com/api/health
```
