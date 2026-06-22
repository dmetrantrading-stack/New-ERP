/**
 * Generates GO-LIVE-CHECKLIST.xlsx in project root.
 * Usage: node scripts/generate-go-live-checklist.mjs
 */
import XLSX from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.resolve(__dirname, '../../GO-LIVE-CHECKLIST.xlsx');

const PASS_OPTS = ['Pass', 'Fail', 'N/A'];

function sheetFromRows(name, headers, rows) {
  const data = [headers, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = headers.map((h, i) => {
    if (h === 'Steps' || h === 'Expected' || h === 'What to verify' || h === 'Notes') return { wch: 42 };
    if (h === 'Task' || h === 'Scenario' || h === 'Report') return { wch: 28 };
    if (h === 'Pass') return { wch: 10 };
    if (h === 'ID' || h === '#') return { wch: 6 };
    return { wch: 18 };
  });
  return { name, ws, rowCount: rows.length + 1 };
}

const overview = [
  ['D METRAN ERP — Go-Live Checklist'],
  [''],
  ['Use Pass column: Pass | Fail | N/A'],
  ['Suggested roles: Admin, Accounting, Sales, Purchasing, Warehouse, Cashier, IT'],
  [''],
  ['Sheet', 'Section', 'Item count'],
  ['A Pre-go-live', 'IT / Admin setup', 10],
  ['B Master data', 'Products, customers, suppliers', 7],
  ['C Purchase', 'PR → PO → GR → APV → Payment', 12],
  ['D Sales', 'SQ → SO → DR → SI → Collection', 17],
  ['E POS', 'Point of sale (if used)', 5],
  ['F Inventory', 'Stock ops', 6],
  ['G Finance', 'Journal entries & reconciliation', 10],
  ['H Tax Reports', 'BIR / accountant sign-off', 8],
  ['I Security', 'Permissions', 5],
  ['J Re-test', 'Recently fixed areas', 6],
  ['K Cutover', 'Go-live day', 5],
  ['Sign-off', 'Approvals', 5],
  ['Reference', 'Document flows & commands', '—'],
  [''],
  ['Document flow'],
  ['Purchases', 'PR → approve → PO → send → GR → APV → Payment Voucher'],
  ['Sales', 'SQ → SO → confirm → DR → post → SI → Collection'],
  ['Returns', 'SI → Sales Return | Supplier → Purchase Return'],
  ['POS', 'Shift → Sale → (optional void) → Close shift'],
];

const stdCols = ['ID', 'Scenario', 'Steps', 'Expected', 'Pass', 'Tester', 'Date', 'Notes'];

const sections = [
  {
    name: 'A Pre-go-live',
    headers: ['ID', 'Task', 'Pass', 'Tester', 'Date', 'Notes'],
    rows: [
      ['A1', 'Run DB migration: cd backend && npm run migrate'],
      ['A2', 'Seed / verify chart of accounts, default locations (Store, Warehouse)'],
      ['A3', 'Business details filled (Settings → Business): name, TIN, address, logo'],
      ['A4', 'Sales workflow set (Settings → Workflow): ordered vs delivered for SI copy'],
      ['A5', 'User accounts created; permissions assigned per role'],
      ['A6', 'Backend builds without errors: cd backend && npm run build'],
      ['A7', 'Smoke test passes: node scripts/smoke-test.mjs (API running)'],
      ['A8', 'Backups configured (PostgreSQL dump + restore test)'],
      ['A9', '.env secured: JWT_SECRET, DB password, not in git'],
      ['A10', 'Production URL / HTTPS / firewall documented'],
    ].map(([id, task]) => [id, task, '', '', '', '']),
  },
  {
    name: 'B Master data',
    headers: stdCols,
    rows: [
      ['B1', 'Create product', 'Products → Add: SKU, name, cost, price, tax type', 'Saves; appears in autocomplete'],
      ['B2', 'Product tax types', 'Create VAT, Exempt, Zero, LGU samples', 'Each selectable on lines'],
      ['B3', 'Category / brand', 'Products tabs CRUD', 'Used on product form'],
      ['B4', 'Customer (credit)', 'Customers → payment terms, limit, TIN', 'Available on SQ/SO/SI'],
      ['B5', 'Supplier', 'Suppliers → payment terms, TIN', 'Available on PO/APV'],
      ['B6', 'Opening inventory', 'Stock Ops or GR/adjustment', 'Qty/cost on SI/PO'],
      ['B7', 'Bank account', 'Bank & Cash → add account', 'On collections/payments'],
    ].map(([id, s, st, ex]) => [id, s, st, ex, '', '', '', '']),
  },
  {
    name: 'C Purchase',
    headers: stdCols,
    rows: [
      ['C1', 'PR create', 'PR with mixed line tax', 'Line tax + totals correct'],
      ['C2', 'PR approve', 'Approve PR', 'Status Approved'],
      ['C3', 'PR → PO copy', 'Copy to PO', 'Prefilled; one toast only'],
      ['C4', 'PO create', 'VAT Inclusive; line tax', 'Subtotal/VAT/total correct'],
      ['C5', 'PO send', 'Send PO', 'Status Sent'],
      ['C6', 'PO → GR', 'Receive from PO', 'Inventory increases'],
      ['C7', 'GR posting', 'Complete GR', 'PO status; Input VAT in reports'],
      ['C8', 'GR → APV', 'APV from GR', 'Lines + supplier invoice fields'],
      ['C9', 'APV post', 'Post APV', 'AP aging updates'],
      ['C10', 'Payment voucher', 'Pay from APV', 'APV paid; bank JE'],
      ['C11', 'Purchase return', 'Create + print', 'Stock reduced'],
      ['C12', 'Audit trail', 'Audit → Purchases/Payables', 'Logged with reference'],
    ].map(([id, s, st, ex]) => [id, s, st, ex, '', '', '', '']),
  },
  {
    name: 'D Sales',
    headers: stdCols,
    rows: [
      ['D1', 'Quotation', 'SQ with line tax', 'Totals + print OK'],
      ['D2', 'SQ → SO copy', 'Copy to SO', 'Single load'],
      ['D3', 'SO confirm', 'Confirm SO', 'Reserved; Open'],
      ['D4', 'SO → DR copy', 'DR from SO', 'Single load'],
      ['D5', 'DR post', 'Post DR', 'Delivered qty; stock OUT'],
      ['D6', 'DR → SI copy', 'Invoice from DR', 'Single toast'],
      ['D7', 'SO → SI copy', 'If workflow=ordered', 'Respects invoice_copy_mode'],
      ['D8', 'SI mixed tax + EWT 1%', 'VAT+Exempt+Zero; EWT 1%', 'EWT bases correct; Amount Due OK'],
      ['D9', 'SI LGU line', 'LGU 5% Final VAT line', 'LGU 5% + 1% EWT'],
      ['D10', 'SI print', 'Print invoice', 'TIN + amounts correct'],
      ['D11', 'SI void', 'Void invoice', 'Stock + AR reversed'],
      ['D12', 'Collection full', 'Collect open invoice', 'Cash+EWT+LGU=applied; balance 0'],
      ['D13', 'Collection partial', 'Partial on mixed-tax SI', 'Proportional EWT'],
      ['D14', 'Collection deep link', '/collections?invoice=id', 'Modal once'],
      ['D15', 'Sales return', 'From invoice', 'Stock IN; print OK'],
      ['D16', 'Customer statement', 'Collections → Statements', 'Matches SI balances'],
      ['D17', 'Audit trail', 'Audit → Sales', 'Before/after on edits'],
    ].map(([id, s, st, ex]) => [id, s, st, ex, '', '', '', '']),
  },
  {
    name: 'E POS',
    headers: stdCols,
    rows: [
      ['E1', 'Open shift', 'POS open shift', 'Shift active'],
      ['E2', 'Cash sale', 'Ring sale', 'Receipt; stock OUT'],
      ['E3', 'Void transaction', 'Void sale', 'Stock restored'],
      ['E4', 'Close shift', 'Close + count', 'Variance recorded'],
      ['E5', 'Thermal print', 'Settings → Printer test', 'Receipt prints'],
    ].map(([id, s, st, ex]) => [id, s, st, ex, '', '', '', '']),
  },
  {
    name: 'F Inventory',
    headers: stdCols,
    rows: [
      ['F1', 'Stock adjustment', 'Adjust +/-', 'Ledger + qty OK'],
      ['F2', 'Stock transfer', 'Between locations', 'From ↓ To ↑'],
      ['F3', 'Inventory count', 'Post variance', 'Qty corrected'],
      ['F4', 'Production', 'Complete order', 'BOM OK'],
      ['F5', 'Low stock report', 'Reports → Low Stock', 'Matches reorder'],
      ['F6', 'Negative inventory', 'Per system setting', 'Policy enforced'],
    ].map(([id, s, st, ex]) => [id, s, st, ex, '', '', '', '']),
  },
  {
    name: 'G Finance',
    headers: stdCols,
    rows: [
      ['G1', 'JE — Sales Invoice', 'Post SI → JEs', 'AR/Revenue/VAT/COGS'],
      ['G2', 'JE — Collection', 'Post collection', 'Cash/AR/WHT Receivable'],
      ['G3', 'JE — GR', 'Post GR', 'Inventory + Input VAT'],
      ['G4', 'JE — APV/Payment', 'Post APV + pay', 'AP + cash correct'],
      ['G5', 'Transaction Audit', 'Accounting → Run audit', 'No missing JEs'],
      ['G6', 'Trial balance', 'TB view', 'Debits = credits'],
      ['G7', 'Bank deposit', 'Deposit collection', 'Bank balance ↑'],
      ['G8', 'Expense / petty cash', 'Post entry', 'JE posted'],
      ['G9', 'AR vs customer balance', 'Compare outstanding', 'Match'],
      ['G10', 'EWT vs invoice', 'Full collection', 'EWT matches invoice'],
    ].map(([id, s, st, ex]) => [id, s, st, ex, '', '', '', '']),
  },
  {
    name: 'H Tax Reports',
    headers: ['ID', 'Report', 'Path', 'Reconcile to', 'Pass', 'Tester', 'Date', 'Notes'],
    rows: [
      ['H1', 'VAT Report', 'Reports → VAT', 'Manual VAT sample month'],
      ['H2', 'Withholding Tax', 'Reports → Withholding Tax', 'EWT on SI + collections'],
      ['H3', 'SLSP Sales', 'Reports → SLSP Sales', 'Posted invoices'],
      ['H4', 'SLSP Purchases', 'Reports → SLSP Purchases', 'GR/APV'],
      ['H5', 'Sales Invoice Register', 'Reports → Register', 'Export CSV'],
      ['H6', 'Purchase Register', 'Reports → Purchase Register', 'Export'],
      ['H7', 'AR Aging', 'Reports → AR Aging', 'Collections outstanding'],
      ['H8', 'AP Aging', 'Reports → AP Aging', 'Supplier balances'],
    ].map(([id, r, p, rec]) => [id, r, p, rec, '', '', '', '']),
  },
  {
    name: 'I Security',
    headers: stdCols,
    rows: [
      ['I1', 'Restricted user', 'No SI create perm', 'Access Denied'],
      ['I2', 'Purchaser only', 'PO yes, APV approve no', 'Blocked on post APV'],
      ['I3', 'Audit view only', 'system.audit.view', 'Audit yes; settings no'],
      ['I4', 'Logout / login', 'Re-login', 'Session cleared; Login logged'],
      ['I5', 'Change password', 'Change password', 'Old password rejected'],
    ].map(([id, s, st, ex]) => [id, s, st, ex, '', '', '', '']),
  },
  {
    name: 'J Re-test',
    headers: ['Area', 'What to verify', 'Pass', 'Tester', 'Date', 'Notes'],
    rows: [
      ['Copy navigation', 'SQ→SO, SO→DR, DR→SI, PR→PO, GR→APV — no double toast/modal', '', '', '', ''],
      ['EWT mixed tax', 'VAT+Exempt+Zero same invoice; ewt_rate saved', '', '', '', ''],
      ['Collections EWT', 'Rate change uses line mix not flat %', '', '', '', ''],
      ['PR/PO line tax', 'Per-line tax; PO header cost basis only', '', '', '', ''],
      ['Audit trail', 'Failed saves (400/500) not logged', '', '', '', ''],
      ['Backend build', 'npm run build succeeds', '', '', '', ''],
    ],
  },
  {
    name: 'K Cutover',
    headers: ['ID', 'Task', 'Pass', 'Tester', 'Date', 'Notes'],
    rows: [
      ['K1', 'Import opening balances (customers, suppliers, inventory)', '', '', '', ''],
      ['K2', 'Freeze legacy system; final sync date agreed', '', '', '', ''],
      ['K3', 'Users trained on document flow', '', '', '', ''],
      ['K4', 'Support contact on cutover day', '', '', '', ''],
      ['K5', 'Rollback plan (DB restore) documented', '', '', '', ''],
    ],
  },
  {
    name: 'Sign-off',
    headers: ['Role', 'Name', 'Signature', 'Date', 'Pass (Approved)'],
    rows: [
      ['Business owner', '', '', '', ''],
      ['Accounting / Finance', '', '', '', ''],
      ['IT / Admin', '', '', '', ''],
      ['Operations (Warehouse)', '', '', '', ''],
      ['Sales lead', '', '', '', ''],
      ['', '', '', '', ''],
      ['Go-live decision', 'Approved / Approved with conditions / Not approved', '', '', ''],
      ['Conditions / open issues', '1.', '', '', ''],
      ['', '2.', '', '', ''],
      ['', '3.', '', '', ''],
    ],
  },
  {
    name: 'Reference',
    headers: ['Topic', 'Detail'],
    rows: [
      ['Smoke test', 'cd backend && node scripts/smoke-test.mjs'],
      ['Migrate', 'cd backend && npm run migrate'],
      ['Build', 'cd backend && npm run build'],
      ['Default login (change before prod)', 'admin / admin123'],
      ['Purchases flow', 'PR → approve → PO → send → GR → APV → Payment Voucher'],
      ['Sales flow', 'SQ → SO → confirm → DR → post → SI → Collection'],
      ['Returns', 'SI → Sales Return | Supplier → Purchase Return'],
      ['POS flow', 'Shift → Sale → void → Close shift'],
    ],
  },
];

const wb = XLSX.utils.book_new();

const overviewWs = XLSX.utils.aoa_to_sheet(overview);
overviewWs['!cols'] = [{ wch: 22 }, { wch: 55 }, { wch: 12 }];
XLSX.utils.book_append_sheet(wb, overviewWs, 'Overview');

for (const sec of sections) {
  const { name, ws } = sheetFromRows(sec.name, sec.headers, sec.rows);
  XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
}

XLSX.writeFile(wb, outPath);
console.log(`Written: ${outPath}`);
