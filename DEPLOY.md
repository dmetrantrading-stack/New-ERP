# D METRAN ERP — Deploy & Restart Checklist

Run this **after every code update** or when new API routes return **404** / SQL errors mention missing tables.

---

## Quick deploy (Windows LAN server)

```powershell
cd "C:\path\to\New-ERP-main\New-ERP-main"

# 1. Database — apply new tables/columns
npm run db:migrate

# 2. Build backend + frontend
npm run build

# 3. Restart API (stop old node on port 5000, then start)
$conn = Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($conn) { Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue; Start-Sleep 2 }
cd backend
node dist/index.js
```

Or use the one-liner from project root:

```powershell
npm run start:prod
```

(`start:prod` runs migrate + `node dist/index.js` — still rebuild frontend separately if UI changed.)

---

## Verify deployment

| Check | Command / URL | Expected |
|-------|---------------|----------|
| API alive | `GET /api/health` | `{ "status": "ok" }` |
| Migrations | `GET /api/health` | `"migrations_ok": true` |
| Auth | Login in browser | Lands on dashboard or first permitted module |
| New routes | e.g. Accounting → P&L | No 404 in browser Network tab |

If `migrations_ok` is **false**, run `npm run db:migrate` and restart.

---

## Common symptoms

| Symptom | Cause | Fix |
|---------|-------|-----|
| **404** on new `/api/...` routes | Stale `backend/dist/` or server not restarted | `npm run build:backend` + restart Node |
| **500** on P&L reports / Loans | Migration not run | `npm run db:migrate` |
| Old UI after deploy | Stale `frontend/dist/` | `npm run build:frontend` + restart (server serves static files) |
| Dashboard empty / 403 toast | User lacks `dashboard.view` | Expected — user lands on first allowed module after P2 fix |

---

## Docker (cloud / VPS)

```bash
docker compose up -d --build
docker compose exec erp sh -c "cd /app/backend && npm run migrate"
```

See [HYBRID-DEPLOYMENT.md](./HYBRID-DEPLOYMENT.md) for HTTPS, CORS, and POS thermal printing.

---

## Full go-live UAT

See [GO-LIVE-CHECKLIST.md](./GO-LIVE-CHECKLIST.md) for module-by-module testing before production cutover.
