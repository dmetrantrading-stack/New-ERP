# D METRAN ERP — Go-Live Checklist

Use this before production cutover. Mark each item **Pass / Fail / N/A** and note the tester, date, and any issue ID.

**Suggested roles:** Admin · Accounting · Sales · Purchasing · Warehouse · Cashier · IT

---

## A. Pre-go-live (IT / Admin)

| # | Task | Pass | Notes |
|---|------|:----:|-------|
| A1 | Run DB migration: `cd backend && npm run migrate` | ☐ | See [DEPLOY.md](./DEPLOY.md) |
| A2 | Seed / verify chart of accounts, default locations (Store, Warehouse) | ☐ | |
| A3 | Business details filled (Settings → Business): name, TIN, address, logo | ☐ | |
| A4 | Sales workflow set (Settings → Workflow): `ordered` vs `delivered` for SI copy | ☐ | |
| A5 | User accounts created; permissions assigned per role (Settings → Permissions) | ☐ | |
| A6 | Backend builds without errors: `cd backend && npm run build` | ☐ | Fix any TS errors first |
| A6b | Restart Node after build; verify `GET /api/health` → `migrations_ok: true` | ☐ | See [DEPLOY.md](./DEPLOY.md) |
| A7 | Smoke test passes: `cd backend && node scripts/smoke-test.mjs` (API running) | ☐ | |
| A8 | Backups configured (PostgreSQL dump schedule + restore test) | ☐ | |
| A9 | `.env` secured: `JWT_SECRET`, DB password, not committed to git | ☐ | |
| A10 | Production URL / HTTPS / firewall rules documented | ☐ | |

---

## B. Master data

| # | Scenario | Steps | Expected | Pass |
|---|----------|-------|----------|:----:|
| B1 | Create product | Products → Add: SKU, name, cost, retail price, **tax type** | Saves; appears in search/autocomplete | ☐ |
| B2 | Product tax types | Create samples: VAT, VAT Exempt, Zero Rated, LGU 5% | Each selectable on sales/purchase lines | ☐ |
| B3 | Category / brand | Products tabs: category + brand CRUD | Used on product form | ☐ |
| B4 | Customer (credit) | Customers → create with payment terms, credit limit, TIN | Available on SQ/SO/SI | ☐ |
| B5 | Supplier | Suppliers → create with payment terms, TIN | Available on PO/APV | ☐ |
| B6 | Opening inventory | Stock Ops → Inventory or GR/adjustment | Qty and cost visible on SI/PO | ☐ |
| B7 | Bank account | Bank & Cash → add account | Available on collections / payments | ☐ |

---

## C. Purchase cycle (PR → PO → GR → APV → Payment)

| # | Scenario | Steps | Expected | Pass |
|---|----------|-------|----------|:----:|
| C1 | **PR create** | Purchase Requisitions → new; mixed line tax (VAT + Exempt + Zero) | Line tax from product; totals correct | ☐ |
| C2 | **PR approve** | Approve PR | Status Approved | ☐ |
| C3 | **PR → PO copy** | Copy to PO from PR | PO prefilled; **one toast only** (no duplicate) | ☐ |
| C4 | **PO create** | PO: VAT Inclusive cost basis; line tax per product | Subtotal, VAT, total correct | ☐ |
| C5 | **PO send** | Send PO to supplier | Status Sent | ☐ |
| C6 | **PO → GR** | Goods Receipts → Receive from PO | Remaining qty only; inventory increases | ☐ |
| C7 | **GR posting** | Complete GR | PO status Partial/Received; **Input VAT** in reports | ☐ |
| C8 | **GR → APV copy** | Payables → APV from GR | APV lines + supplier invoice fields | ☐ |
| C9 | **APV post** | Post APV | Supplier balance / AP aging updates | ☐ |
| C10 | **Payment voucher** | Payables → Payment from APV (`pay_apv` link) | APV paid/partial; bank/cash JE | ☐ |
| C11 | **Purchase return** | Purchase Returns → create + print | Stock reduced; print OK | ☐ |
| C12 | **Audit trail** | Audit → filter Purchases / Payables | Create PO, GR, APV logged with reference | ☐ |

---

## D. Sales cycle (SQ → SO → DR → SI → Collection)

| # | Scenario | Steps | Expected | Pass |
|---|----------|-------|----------|:----:|
| D1 | **Quotation** | Sales Quotations → create; line tax from product | Totals OK; print OK | ☐ |
| D2 | **SQ → SO copy** | Copy to Sales Order | SO prefilled; **single load** | ☐ |
| D3 | **SO confirm** | Confirm SO | Inventory reserved; status Open | ☐ |
| D4 | **SO → DR copy** | Delivery Receipt from SO (`so_id` URL) | DR lines; **single load** | ☐ |
| D5 | **DR post** | Post DR | SO delivered qty updated; inventory OUT | ☐ |
| D6 | **DR → SI copy** | Sales Invoice from DR | Items/customer copied; **single toast** | ☐ |
| D7 | **SO → SI copy** | (If workflow = ordered) Invoice from SO | Respects `invoice_copy_mode` setting | ☐ |
| D8 | **SI — mixed tax + EWT 1%** | One invoice: VAT + VAT Exempt + Zero Rated lines; EWT 1% | EWT on VAT (net of VAT), exempt & zero at full amount; **Amount Due** = gross − EWT − LGU | ☐ |
| D9 | **SI — LGU line** | Line tax = LGU 5% Final VAT | LGU 5% + 1% EWT on net-of-VAT | ☐ |
| D10 | **SI print** | Print invoice | Layout, TIN, line amounts correct | ☐ |
| D11 | **SI void** | Void posted invoice | Stock restored; AR reversed; status Void | ☐ |
| D12 | **Collection — full** | Collections → Collect on open invoice | EWT split correct; cash + EWT + LGU = applied; balance 0 | ☐ |
| D13 | **Collection — partial** | Partial payment on mixed-tax invoice | EWT proportional; balance correct | ☐ |
| D14 | **Collection deep link** | Open `/collections?invoice={id}` | Modal opens **once** (StrictMode) | ☐ |
| D15 | **Sales return** | Copy from invoice → Sales Return | Qty capped; stock IN; print OK | ☐ |
| D16 | **Customer statement** | Collections → Statements → view customer | Outstanding matches SI balances | ☐ |
| D17 | **Audit trail** | Audit → Sales actions | SI create/edit/void/collection with before/after | ☐ |

---

## E. POS (if used)

| # | Scenario | Steps | Expected | Pass |
|---|----------|-------|----------|:----:|
| E1 | Open shift | POS → open shift with opening cash | Shift active | ☐ |
| E2 | Cash sale | Ring sale; payment | Receipt; inventory OUT; shift total | ☐ |
| E3 | Void transaction | Void recent sale | Stock restored | ☐ |
| E4 | Close shift | Close shift; count cash | Z-reading / variance recorded | ☐ |
| E5 | Thermal print | Settings → Printer; test print (if hardware) | Receipt prints | ☐ |

---

## F. Inventory & stock ops

| # | Scenario | Steps | Expected | Pass |
|---|----------|-------|----------|:----:|
| F1 | Stock adjustment | Stock Ops → Inventory → adjust +/- | Ledger entry; qty updated | ☐ |
| F2 | Stock transfer | Transfers between locations | From ↓, To ↑ | ☐ |
| F3 | Inventory count | Create count → post variance | Variance report; qty corrected | ☐ |
| F4 | Production order | Production → complete (if used) | BOM consumption / output | ☐ |
| F5 | Low stock report | Reports → Low Stock | Matches reorder levels | ☐ |
| F6 | Negative inventory | Settings / system flag (if enabled) | SI allowed or blocked per policy | ☐ |

---

## G. Finance & accounting

| # | Scenario | Steps | Expected | Pass |
|---|----------|-------|----------|:----:|
| G1 | **Auto JE — Sales Invoice** | Post SI → Accounting → Journal Entries | DR AR / CR Revenue + VAT; COGS if applicable | ☐ |
| G2 | **Auto JE — Collection** | Post collection | DR Cash/Bank; CR AR; DR WHT Receivable if EWT | ☐ |
| G3 | **Auto JE — GR** | Post goods receipt | DR Inventory + Input VAT; CR AP/accrual | ☐ |
| G4 | **Auto JE — APV / Payment** | Post APV; pay voucher | AP and cash accounts correct | ☐ |
| G5 | **Transaction Audit** | Accounting → Transaction Audit → Run | Missing journal = 0 for test period | ☐ |
| G6 | **Trial balance** | Accounting → reports / TB view | Debits = credits | ☐ |
| G7 | Bank deposit | Bank & Cash → deposit from collection | Bank balance ↑ | ☐ |
| G8 | Expense / petty cash | Expense or Petty Cash entry | JE posted | ☐ |
| G9 | **AR vs customer balance** | Compare Collections outstanding vs customer master balance | Match after test transactions | ☐ |
| G10 | **EWT vs invoice** | SI with EWT → collection | `withholding_tax` on invoice = EWT on collection (full pay) | ☐ |

---

## H. Tax & BIR reports (accountant sign-off)

| # | Report | Path | Reconcile to | Pass |
|---|--------|------|--------------|:----:|
| H1 | VAT Report | Reports → VAT | Manual VAT computation for sample month | ☐ |
| H2 | Withholding Tax | Reports → Withholding Tax | EWT on SI + collections | ☐ |
| H3 | SLSP Sales | Reports → SLSP Sales | Sample posted invoices | ☐ |
| H4 | SLSP Purchases | Reports → SLSP Purchases | Sample GR/APV | ☐ |
| H5 | Sales Invoice Register | Reports → Sales Invoice Register | SI list + export CSV | ☐ |
| H6 | Purchase Register | Reports → Purchase Register | PO/GR/APV + export | ☐ |
| H7 | AR Aging | Reports → AR Aging | Collections outstanding | ☐ |
| H8 | AP Aging | Reports → AP Aging | Supplier balances | ☐ |

---

## I. Security & permissions

| # | Scenario | Steps | Expected | Pass |
|---|----------|-------|----------|:----:|
| I1 | Restricted user | Login as role **without** SI create | Cannot create invoice (Access Denied) | ☐ |
| I2 | Purchaser only | User with PO but no APV approve | Can create PO; cannot post APV | ☐ |
| I3 | Audit view only | User with `system.audit.view` | Can open `/audit`; cannot edit settings | ☐ |
| I4 | Logout / login | Logout; login again | Session cleared; audit logs Login | ☐ |
| I5 | Change password | User profile / change password | Works; old password rejected | ☐ |

---

## J. Known areas to double-check (from recent development)

These were fixed or improved recently — **re-test before go-live**:

| Area | What to verify |
|------|----------------|
| Copy navigation | SQ→SO, SO→DR, DR→SI, PR→PO, GR→APV, SI duplicate — **no double toast/modal** |
| EWT mixed tax | VAT + Exempt + Zero on **same invoice**; EWT rate saved on invoice (`ewt_rate` column) |
| Collections EWT | Changing EWT rate on collect screen recalculates from line mix, not flat % on total |
| PR/PO line tax | Per-line VAT / Exempt / Zero / LGU; PO header = cost basis only |
| Audit trail | Failed saves (400/500) should **not** appear in audit log |
| Backend build | `payables.routes.ts` must compile (run `npm run build`) |

---

## K. Performance & cutover day

| # | Task | Pass |
|---|------|:----:|
| K1 | Import opening balances (customers, suppliers, inventory) in controlled batch | ☐ |
| K2 | Freeze legacy system; final sync date agreed | ☐ |
| K3 | All users trained on document flow (diagram below) | ☐ |
| K4 | Support contact / escalation on cutover day | ☐ |
| K5 | Rollback plan documented (restore DB backup) | ☐ |

---

## Document flow (reference)

```
Purchases:  PR → approve → PO → send → GR → APV → Payment Voucher
Sales:      SQ → SO → confirm → DR → post → SI → Collection
Returns:    SI → Sales Return  |  Supplier → Purchase Return
POS:        Shift → Sale → (optional void) → Close shift
```

---

## Sign-off

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Business owner | | | |
| Accounting / Finance | | | |
| IT / Admin | | | |
| Operations (Warehouse) | | | |
| Sales lead | | | |

**Go-live decision:** ☐ Approved  ☐ Approved with conditions  ☐ Not approved  

**Conditions / open issues:**

```
1.
2.
3.
```

---

## Quick commands

```bash
# Backend
cd backend
npm run migrate
npm run build
npm run dev          # or npm start after build

# Smoke test (backend must be running on :5000)
node scripts/smoke-test.mjs

# Frontend
cd frontend
npm run dev
```

Default smoke-test login: `admin` / `admin123` (change before production).
