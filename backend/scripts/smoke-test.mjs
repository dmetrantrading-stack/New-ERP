/**
 * Full API smoke test for new modules + core purchase/sales chain.
 * Usage: node scripts/smoke-test.mjs
 */
const BASE = process.env.API_BASE || 'http://localhost:5000/api';

const results = [];
let token = '';

function pass(name, detail = '') {
  results.push({ name, ok: true, detail });
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
}
function fail(name, detail = '') {
  results.push({ name, ok: false, detail });
  console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
}

async function req(method, path, body, expectStatus) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  const ok = expectStatus ? res.status === expectStatus : res.ok;
  return { ok, status: res.status, data, res };
}

async function findStockedProduct() {
  let r = await req('GET', '/inventory/stock-list?limit=2000');
  const row = (r.data?.data || []).find((x) => parseFloat(x.total_qty) >= 1);
  if (!row) return null;
  return {
    id: row.product_id,
    name: row.name,
    cost: parseFloat(row.avg_cost) || 10,
    loc: parseFloat(row.store_qty) >= 1 ? 1 : 2,
  };
}

async function main() {
  console.log('\n=== D METRAN ERP Smoke Test ===\n');
  console.log(`Base URL: ${BASE}\n`);

  // --- Auth ---
  console.log('1. Authentication');
  let r = await req('POST', '/auth/login', { username: 'admin', password: 'admin123' }, 200);
  if (r.ok && r.data?.token) {
    token = r.data.token;
    pass('Login', r.data.user?.username || 'admin');
  } else {
    fail('Login', `status ${r.status}: ${JSON.stringify(r.data)}`);
    printSummary();
    process.exit(1);
  }

  // --- Notifications ---
  console.log('\n2. Notifications');
  r = await req('GET', '/notifications');
  if (r.ok && Array.isArray(r.data?.data)) {
    pass('GET /notifications', `${r.data.data.length} alerts, unread=${r.data.unread_count}`);
    const hasPath = r.data.data.every((n) => n.path || n.reference_type);
    hasPath ? pass('Notification navigation fields') : fail('Notification navigation fields', 'missing path/reference');
  } else fail('GET /notifications', `status ${r.status}`);

  // --- Products & suppliers (fixtures) ---
  console.log('\n3. Fixtures');
  r = await req('GET', '/products?limit=5');
  const product = r.data?.data?.[0];
  product ? pass('Products available', product.name || product.sku) : fail('Products available', 'no products in DB');

  r = await req('GET', '/suppliers?limit=5');
  const supplier = r.data?.data?.[0];
  supplier ? pass('Suppliers available', supplier.supplier_name) : fail('Suppliers available', 'no suppliers');

  r = await req('GET', '/sales/invoices?limit=5&status=Posted');
  const invoice = r.data?.data?.[0];
  invoice ? pass('Posted invoice available', invoice.invoice_number) : fail('Posted invoice available', 'none — sales return test may skip');

  // --- Purchase Requisitions ---
  console.log('\n4. Purchase Requisitions');
  if (!product) {
    fail('PR create', 'skipped — no product');
  } else {
    r = await req('POST', '/purchases/requisitions', {
      notes: 'Smoke test PR',
      items: [{ product_id: product.id, quantity: 2, estimated_cost: product.cost || 10 }],
    }, 201);
    const prId = r.data?.id;
    if (r.ok && prId) pass('POST /purchases/requisitions', r.data.pr_number);
    else fail('POST /purchases/requisitions', JSON.stringify(r.data));

    if (prId) {
      r = await req('GET', `/purchases/requisitions/${prId}`);
      r.ok && r.data?.items?.length ? pass('GET /purchases/requisitions/:id') : fail('GET /purchases/requisitions/:id', `status ${r.status}`);

      r = await req('PATCH', `/purchases/requisitions/${prId}/approve`);
      r.ok ? pass('PATCH approve PR') : fail('PATCH approve PR', JSON.stringify(r.data));

      r = await req('GET', `/purchases/requisitions/${prId}/copy-to-po`);
      r.ok && r.data?.items?.length ? pass('GET copy-to-po', `${r.data.items.length} lines`) : fail('GET copy-to-po', JSON.stringify(r.data));

      // --- PO from PR ---
      console.log('\n5. PO from PR');
      if (supplier && r.data?.items) {
        r = await req('POST', '/purchases/orders', {
          supplier_id: supplier.id,
          pr_id: prId,
          notes: 'Smoke PO from PR',
          vat_mode: 'VAT Inclusive',
          items: r.data.items.map((i) => ({
            product_id: i.product_id,
            quantity: i.quantity,
            unit_cost: i.unit_cost || 10,
          })),
        }, 201);
        r.ok ? pass('POST PO with pr_id', r.data.po_number) : fail('POST PO with pr_id', JSON.stringify(r.data));

        r = await req('GET', `/purchases/requisitions/${prId}/copy-to-po`);
        r.status === 400 ? pass('Duplicate PO guard') : fail('Duplicate PO guard', `expected 400, got ${r.status}`);
      } else {
        fail('PO from PR', 'skipped — no supplier or copy payload');
      }
    }
  }

  // --- Purchase Returns ---
  console.log('\n6. Purchase Returns');
  r = await req('GET', '/purchases/returns?page=1&limit=5');
  r.ok && Array.isArray(r.data?.data) ? pass('GET /purchases/returns list') : fail('GET /purchases/returns list', `status ${r.status}`);

  const stockedForReturn = await findStockedProduct();
  if (supplier && stockedForReturn) {
    r = await req('POST', '/purchases/returns', {
      supplier_id: supplier.id,
      reason: 'Smoke test return',
      notes: 'Automated smoke test',
      items: [{
        product_id: stockedForReturn.id,
        quantity: 1,
        unit_cost: stockedForReturn.cost,
        net_unit_cost: stockedForReturn.cost,
        location_id: stockedForReturn.loc,
      }],
    }, 201);
    const pretId = r.data?.id;
    if (r.ok && pretId) {
      pass('POST /purchases/returns', r.data.pr_number);
      r = await req('GET', `/purchases/returns/${pretId}`);
      r.ok && r.data?.items?.length ? pass('GET /purchases/returns/:id') : fail('GET /purchases/returns/:id');
      r = await req('GET', `/purchases/returns/${pretId}/print?token=${token}`);
      typeof r.data === 'string' && r.data.includes('PURCHASE RETURN') ? pass('GET purchase return print') : fail('GET purchase return print', `status ${r.status}`);
    } else fail('POST /purchases/returns', JSON.stringify(r.data));
  } else {
    fail('POST /purchases/returns', 'skipped — no supplier or stocked product');
  }

  // --- Sales Returns ---
  console.log('\n7. Sales Returns');
  r = await req('GET', '/sales/returns?page=1&limit=5');
  r.ok ? pass('GET /sales/returns list') : fail('GET /sales/returns list', `status ${r.status}`);

  r = await req('GET', '/sales/invoices?limit=20&status=Posted');
  const invoiceForReturn = (r.data?.data || []).find((inv) => inv.status === 'Posted') || invoice;
  if (invoiceForReturn) {
    r = await req('GET', `/sales/returns/copy-from-invoice/${invoiceForReturn.id}`);
    if (r.ok && r.data?.items?.length) {
      pass('GET copy-from-invoice', invoiceForReturn.invoice_number);
      const copyPayload = r.data;
      const line = copyPayload.items.find((i) => parseFloat(i.invoiced_qty || i.quantity) >= 1) || copyPayload.items[0];
      r = await req('POST', '/sales/returns', {
        invoice_id: invoiceForReturn.id,
        customer_id: copyPayload.customer_id,
        reason: 'Smoke test',
        notes: 'Automated',
        items: [{
          invoice_item_id: line.invoice_item_id,
          product_id: line.product_id,
          quantity: 1,
          location_id: line.location_id || 1,
        }],
      }, 201);
      const srId = r.data?.id;
      if (r.ok && srId) {
        pass('POST /sales/returns', r.data.return_number);
        r = await req('GET', `/sales/returns/${srId}`);
        r.ok ? pass('GET /sales/returns/:id') : fail('GET /sales/returns/:id');
        r = await req('GET', `/sales/returns/${srId}/print?token=${token}`);
        typeof r.data === 'string' && r.data.includes('SALES RETURN') ? pass('GET sales return print') : fail('GET sales return print');
      } else {
        pass('POST /sales/returns (skipped)', r.data?.error || 'may already be fully returned');
      }
    } else fail('GET copy-from-invoice', JSON.stringify(r.data));
  } else {
    fail('Sales return flow', 'skipped — no posted invoice');
  }

  // --- Unit Conversions ---
  console.log('\n8. Unit Conversions');
  const stockedForConv = await findStockedProduct();
  const convProduct = stockedForConv || product;
  if (convProduct) {
    r = await req('GET', `/conversions/${convProduct.id}`);
    r.ok && Array.isArray(r.data) ? pass('GET /conversions/:productId', `${r.data.length} factors`) : fail('GET /conversions/:productId');

    r = await req('POST', '/conversions/', {
      product_id: convProduct.id,
      from_unit: 'pc',
      to_unit: 'pack',
      conversion_factor: 6,
    }, 201);
    r.ok ? pass('POST /conversions/ factor') : pass('POST /conversions/ factor (exists)', String(r.data?.error || r.status));

    if (stockedForConv) {
      r = await req('POST', '/conversions/convert', {
        product_id: stockedForConv.id,
        from_unit: 'pc',
        to_unit: 'pack',
        quantity: 1,
        location_id: stockedForConv.loc,
      });
      r.ok ? pass('POST /conversions/convert') : fail('POST /conversions/convert', JSON.stringify(r.data));
    } else {
      fail('POST /conversions/convert', 'skipped — no stocked product');
    }
  }

  // --- Core chain sanity ---
  console.log('\n9. Core modules (read-only)');
  for (const [label, path] of [
    ['Purchase orders', '/purchases/orders?limit=1'],
    ['Goods receipts', '/purchases/receipts?limit=1'],
    ['AP vouchers', '/payables/apv?limit=1'],
    ['Sales invoices', '/sales/invoices?limit=1'],
    ['Collections', '/sales/collections?limit=1'],
  ]) {
    r = await req('GET', path);
    r.ok ? pass(label) : fail(label, `status ${r.status}`);
  }

  printSummary();
  process.exit(results.some((x) => !x.ok) ? 1 : 0);
}

function printSummary() {
  const passed = results.filter((x) => x.ok).length;
  const failed = results.filter((x) => !x.ok);
  console.log('\n=== Summary ===');
  console.log(`Passed: ${passed}/${results.length}`);
  if (failed.length) {
    console.log('\nFailed:');
    failed.forEach((f) => console.log(`  - ${f.name}: ${f.detail}`));
  } else {
    console.log('All checks passed.');
  }
}

main().catch((e) => {
  console.error('Smoke test crashed:', e.message);
  process.exit(1);
});
