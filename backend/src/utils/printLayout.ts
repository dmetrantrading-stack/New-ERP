/** Shared modern A4 print layout — blue header, info boxes, compact tables. */

import { formatAmountInWords } from './amountInWords';

export const PRINT_CSS = `
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Inter,'Segoe UI',Arial,sans-serif;font-size:11px;color:#1f2937;background:#fff;padding:10mm 12mm;max-width:210mm;margin:0 auto;line-height:1.45}
body.landscape{max-width:297mm;padding:8mm 10mm}
.top-header{display:flex;align-items:flex-start;gap:14px;padding-bottom:12px;border-bottom:2px solid #1E40AF;margin-bottom:0}
.logo-box{width:52px;height:52px;background:#1E40AF;border-radius:6px;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#fff;font-size:9px;font-weight:700;text-align:center;line-height:1.1;padding:4px}
.company-info{flex:1}
.company-info h1{font-size:20px;font-weight:700;color:#1E40AF;letter-spacing:0.5px;margin-bottom:2px}
.company-info .tagline{font-size:10px;color:#4b5563;margin-bottom:4px}
.company-info .meta{font-size:9px;color:#6b7280;line-height:1.5}
.title-bar{display:flex;align-items:center;justify-content:space-between;background:#EFF6FF;border:1px solid #BFDBFE;border-top:none;padding:10px 14px;margin-bottom:14px}
.title-bar h2{font-size:15px;font-weight:700;color:#1E40AF;letter-spacing:2px}
.title-bar .doc-sub{font-size:9px;color:#6b7280;margin-top:2px}
.title-bar .doc-meta{text-align:right}
.title-bar .doc-num{font-family:ui-monospace,'Courier New',monospace;font-size:12px;font-weight:700;color:#111827}
.badge{display:inline-block;margin-top:4px;padding:2px 8px;border-radius:999px;font-size:9px;font-weight:600;text-transform:uppercase}
.badge-posted{background:#DCFCE7;color:#166534}
.badge-draft{background:#F3F4F6;color:#374151}
.badge-cancelled{background:#FEE2E2;color:#991B1B}
.badge-partial{background:#FEF3C7;color:#92400E}
.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px}
.info-grid.cols-3{grid-template-columns:repeat(3,1fr)}
.info-box{border:1px solid #E5E7EB;border-radius:6px;padding:10px 12px;background:#FAFAFA}
.info-box .label{font-size:9px;font-weight:700;text-transform:uppercase;color:#1E40AF;letter-spacing:0.8px;margin-bottom:8px;padding-bottom:4px;border-bottom:1px solid #E5E7EB}
.info-box p{font-size:10px;margin:3px 0;color:#374151}
.info-box p strong{color:#111827;font-weight:600}
.info-box .highlight{font-weight:700;color:#1E40AF}
.info-box .amount{font-size:16px;font-weight:700;color:#1E40AF;margin-top:6px}
.items-table{width:100%;border-collapse:collapse;margin-bottom:14px;border:1px solid #E5E7EB;border-radius:6px;overflow:hidden}
.items-table thead tr{background:#1E40AF;color:#fff}
.items-table th{padding:8px 10px;font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;text-align:left}
.items-table th.c,.items-table td.c{text-align:center}
.items-table th.r,.items-table td.r{text-align:right}
.items-table tbody tr:nth-child(even){background:#F9FAFB}
.items-table td{padding:7px 10px;font-size:10px;border-top:1px solid #E5E7EB;vertical-align:top}
.bottom-grid{display:grid;grid-template-columns:1fr 240px;gap:14px;margin-bottom:20px;align-items:start}
.bottom-grid.wide-right{grid-template-columns:1fr 280px}
.sales-print-footer{display:flex;justify-content:space-between;align-items:flex-end;gap:14px;margin-bottom:20px}
.sales-print-footer-left{flex:1;min-width:0;display:flex;flex-direction:column;gap:10px}
.sales-print-footer-right{flex:0 0 280px;margin-left:auto}
.notes-box{border:1px solid #E5E7EB;border-radius:6px;padding:10px 12px;min-height:60px;background:#FAFAFA}
.notes-box .label{font-size:9px;font-weight:700;text-transform:uppercase;color:#6B7280;margin-bottom:6px}
.notes-box p{font-size:10px;color:#374151;white-space:pre-wrap}
.notes-box .standard-notice{font-style:italic;color:#4B5563;line-height:1.6}
.summary-box{border:2px solid #1E40AF;border-radius:6px;padding:12px 14px;background:#fff}
.summary-box .label{font-size:9px;font-weight:700;text-transform:uppercase;color:#1E40AF;margin-bottom:8px}
.summary-row{display:flex;justify-content:space-between;font-size:10px;padding:4px 0;color:#374151}
.summary-row.total{margin-top:8px;padding-top:10px;border-top:2px solid #1E40AF;font-size:13px;font-weight:700;color:#1E40AF}
.terms-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px}
.terms-box{border:1px solid #E5E7EB;border-radius:6px;padding:10px 12px;background:#FAFAFA}
.terms-box .terms-title{font-size:9px;font-weight:700;text-transform:uppercase;color:#1E40AF;margin-bottom:6px}
.terms-box p{font-size:9px;color:#374151;line-height:1.5}
.section-title{font-size:9px;font-weight:700;text-transform:uppercase;color:#1E40AF;letter-spacing:0.8px;margin:14px 0 8px;padding-bottom:4px;border-bottom:1px solid #E5E7EB}
.aging-row{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin:14px 0}
.aging-box{border:1px solid #E5E7EB;border-radius:6px;padding:8px;text-align:center;background:#FAFAFA}
.aging-box .aging-amt{font-size:11px;font-weight:700;color:#1E40AF}
.aging-box .aging-lbl{font-size:7px;text-transform:uppercase;color:#6B7280;margin-top:2px}
.total-banner{text-align:right;font-size:14px;font-weight:700;color:#1E40AF;padding:10px 14px;border:2px solid #1E40AF;border-radius:6px;margin:14px 0}
.meta-line{font-size:10px;color:#374151;margin-bottom:10px}
.meta-line strong{color:#111827}
.signatures{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:8px;margin-bottom:16px}
.signatures.cols-3{grid-template-columns:repeat(3,1fr)}
.signatures.cols-2{grid-template-columns:repeat(2,1fr)}
.sig-img{max-height:44px;max-width:130px;display:block;margin:0 auto 4px;object-fit:contain}
.sig-block{text-align:center}
.sig-line{border-bottom:1px solid #111827;height:36px;margin-bottom:5px}
.sig-label{font-size:8px;font-weight:600;text-transform:uppercase;color:#6B7280;letter-spacing:0.3px}
.sig-sub{font-size:7px;color:#9CA3AF;margin-top:2px}
.footer-note{text-align:center;font-size:8px;color:#9CA3AF;padding-top:10px;border-top:1px solid #E5E7EB}
@media print{
  body{padding:8mm 10mm;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body.landscape{padding:6mm 8mm}
  .title-bar,.items-table thead tr,.logo-box,.summary-box,.total-banner{border-color:#1E40AF!important}
}
`.trim();

export function fc(val: unknown): string {
  const n = parseFloat(String(val ?? ''));
  return isNaN(n) ? '0.00' : n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtCurrency(val: unknown): string {
  return `₱${fc(val)}`;
}

export function fmtDate(val: unknown, format: 'short' | 'long' = 'long'): string {
  if (!val) return '—';
  const opts: Intl.DateTimeFormatOptions = format === 'short'
    ? { year: 'numeric', month: 'short', day: 'numeric' }
    : { year: 'numeric', month: 'long', day: 'numeric' };
  return new Date(String(val)).toLocaleDateString('en-PH', opts);
}

export function badgeClass(status?: string): string {
  if (!status) return 'badge-draft';
  const s = status.toLowerCase();
  if (['posted', 'paid', 'approved', 'completed'].includes(s)) return 'badge-posted';
  if (['cancelled', 'void', 'rejected'].includes(s)) return 'badge-cancelled';
  if (['partial', 'overdue', 'pending'].includes(s)) return 'badge-partial';
  return 'badge-draft';
}

/** Company contact block: address, Tel, Email, then TIN (email between Tel and TIN). */
export function renderCompanyContactLines(b: Record<string, unknown>): string {
  const companyLine = [b.address, b.city, b.province].filter(Boolean).join(', ');
  const tel = b.telephone_number || b.mobile_number;
  const lines = [
    companyLine ? `<div>${companyLine}</div>` : '',
    tel ? `<div>Tel: ${tel}</div>` : '',
    b.email_address ? `<div>Email: ${b.email_address}</div>` : '',
    `<div>TIN: ${b.tin_number || '—'} · ${b.vat_type || 'VAT Registered'}</div>`,
  ].filter(Boolean);
  return lines.join('');
}

export function renderCompanyHeader(b: Record<string, unknown>): string {
  const initials = String(b.business_name || 'DM').substring(0, 2).toUpperCase();

  return `
<div class="top-header">
  <div class="logo-box">${initials}</div>
  <div class="company-info">
    <h1>${b.business_name || 'D METRAN TRADING'}</h1>
    <div class="tagline">${b.trade_name || 'General Merchandise & Integrated Trade Distribution'}</div>
    <div class="meta">
      ${renderCompanyContactLines(b)}
    </div>
  </div>
</div>`;
}

export function renderTitleBar(docTitle: string, docNumber?: string, status?: string, subtitle?: string): string {
  const badge = status ? `<span class="badge ${badgeClass(status)}">${status}</span>` : '';
  const sub = subtitle ? `<div class="doc-sub">${subtitle}</div>` : '';
  return `
<div class="title-bar">
  <div>
    <h2>${docTitle}</h2>
    ${sub}
  </div>
  <div class="doc-meta">
    ${docNumber ? `<div class="doc-num">${docNumber}</div>` : ''}
    ${badge}
  </div>
</div>`;
}

export function renderInfoBox(label: string, content: string): string {
  return `
<div class="info-box">
  <div class="label">${label}</div>
  ${content}
</div>`;
}

export function renderInfoGrid(boxes: { label: string; content: string }[], cols?: 2 | 3): string {
  const cls = cols === 3 ? ' info-grid cols-3' : '';
  return `<div class="info-grid${cls}">${boxes.map((box) => renderInfoBox(box.label, box.content)).join('')}</div>`;
}

export interface TableHeader {
  text: string;
  align?: 'left' | 'center' | 'right';
  width?: string;
}

export function renderItemsTable(headers: TableHeader[], bodyRows: string): string {
  const ths = headers.map((h) => {
    const cls = h.align === 'center' ? ' class="c"' : h.align === 'right' ? ' class="r"' : '';
    const style = h.width ? ` style="width:${h.width}"` : '';
    return `<th${cls}${style}>${h.text}</th>`;
  }).join('');
  const empty = `<tr><td colspan="${headers.length}" style="text-align:center;padding:16px;color:#9CA3AF">No items</td></tr>`;
  return `
<table class="items-table">
  <thead><tr>${ths}</tr></thead>
  <tbody>${bodyRows || empty}</tbody>
</table>`;
}

export function tableRow(cells: { html: string; align?: 'c' | 'r' }[]): string {
  return `<tr>${cells.map((c) => {
    const cls = c.align ? ` class="${c.align}"` : '';
    return `<td${cls}>${c.html}</td>`;
  }).join('')}</tr>`;
}

export function renderSummaryBox(label: string, rows: { label: string; value: string; total?: boolean }[]): string {
  const rowHtml = rows.map((r) =>
    `<div class="summary-row${r.total ? ' total' : ''}"><span>${r.label}</span><span>${r.value}</span></div>`
  ).join('');
  return `
<div class="summary-box">
  <div class="label">${label}</div>
  ${rowHtml}
</div>`;
}

export function renderNotesBox(label: string, content: string, contentClass = ''): string {
  const cls = contentClass ? ` class="${contentClass}"` : '';
  return `
<div class="notes-box">
  <div class="label">${label}</div>
  <p${cls}>${content || '—'}</p>
</div>`;
}

export function renderBottomGrid(leftHtml: string, rightHtml: string, wideRight = false): string {
  const cls = wideRight ? ' bottom-grid wide-right' : ' bottom-grid';
  return `<div class="${cls.trim()}">${leftHtml}${rightHtml}</div>`;
}

/** SQ/SO print: notes/terms on the left, sales summary anchored lower-right. */
export function renderSalesPrintFooter(
  leftHtml: string,
  summaryLabel: string,
  summaryRows: { label: string; value: string; total?: boolean }[],
): string {
  return `
<div class="sales-print-footer">
  <div class="sales-print-footer-left">${leftHtml}</div>
  <div class="sales-print-footer-right">${renderSummaryBox(summaryLabel, summaryRows)}</div>
</div>`;
}

export function renderTermsGrid(boxes: { title: string; content: string }[]): string {
  return `
<div class="terms-grid">
  ${boxes.map((box) => `
  <div class="terms-box">
    <div class="terms-title">${box.title}</div>
    <p>${box.content}</p>
  </div>`).join('')}
</div>`;
}

export function renderSectionTitle(title: string): string {
  return `<div class="section-title">${title}</div>`;
}

export function renderAgingRow(aging: Record<string, number>): string {
  const buckets = [
    { key: 'current', label: 'Current' },
    { key: 'd30', label: '1–30 Days' },
    { key: 'd60', label: '31–60 Days' },
    { key: 'd90', label: '61–90 Days' },
    { key: 'over90', label: '90+ Days' },
  ];
  return `
<div class="aging-row">
  ${buckets.map((b) => `
  <div class="aging-box">
    <div class="aging-amt">${fmtCurrency(aging[b.key] || 0)}</div>
    <div class="aging-lbl">${b.label}</div>
  </div>`).join('')}
</div>`;
}

export function renderSignatures(labels: (string | { label: string; sub?: string; imageUrl?: string })[], cols?: 2 | 3 | 4): string {
  const colCls = cols === 2 ? ' cols-2' : cols === 3 ? ' cols-3' : '';
  const blocks = labels.map((l) => {
    const label = typeof l === 'string' ? l : l.label;
    const sub = typeof l === 'string' ? '' : (l.sub ? `<div class="sig-sub">${l.sub}</div>` : '');
    const img = typeof l === 'object' && l.imageUrl ? `<img src="${l.imageUrl}" class="sig-img" alt="" />` : '';
    return `<div class="sig-block">${img}<div class="sig-line"></div><div class="sig-label">${label}</div>${sub}</div>`;
  }).join('');
  return `<div class="signatures${colCls}">${blocks}</div>`;
}

export function renderFooter(note?: string): string {
  const text = note || `Computer-generated document · Printed ${new Date().toLocaleString('en-PH')}`;
  return `<div class="footer-note">${text}</div>`;
}

/** SAP/Oracle-style formal print theme — sharp grids, minimal color. */
export const PRINT_CSS_ENTERPRISE = `
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Arial,Helvetica,'Segoe UI',sans-serif;font-size:9pt;color:#000;background:#fff;padding:12mm 14mm;max-width:210mm;margin:0 auto;line-height:1.35}
body.landscape{max-width:297mm;padding:10mm 12mm}
body.ent-draft{position:relative}
body.ent-draft::before{content:'DRAFT';position:fixed;top:42%;left:50%;transform:translate(-50%,-50%) rotate(-32deg);font-size:96pt;font-weight:700;color:#000;opacity:0.06;letter-spacing:12px;pointer-events:none;z-index:0}
body.ent-draft>*{position:relative;z-index:1}
.ent-header{border-bottom:2px solid #000;padding-bottom:8px;margin-bottom:10px}
.ent-header-top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:8px}
.ent-company{display:flex;align-items:flex-start;gap:10px;flex:1;min-width:0}
.ent-logo{width:56px;height:56px;object-fit:contain;flex-shrink:0}
.ent-logo-fallback{width:56px;height:56px;border:1px solid #666;display:flex;align-items:center;justify-content:center;font-size:7pt;font-weight:700;text-align:center;flex-shrink:0}
.ent-company-name{font-size:13pt;font-weight:700;text-transform:uppercase;letter-spacing:0.3px;margin-bottom:2px}
.ent-company-trade{font-size:8pt;color:#333;margin-bottom:3px}
.ent-company-meta{font-size:7.5pt;color:#333;line-height:1.45}
.ent-doc-title{text-align:right;flex-shrink:0}
.ent-doc-title h1{font-size:14pt;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:2px}
.ent-doc-title .ent-doc-sub{font-size:7.5pt;color:#333;text-transform:uppercase;letter-spacing:0.5px}
.ent-doc-strip{width:100%;border-collapse:collapse;margin-bottom:10px;font-size:8pt}
.ent-doc-strip td{border:1px solid #333;padding:3px 6px;vertical-align:middle}
.ent-doc-strip .ent-lbl{background:#ececec;font-weight:700;width:14%;white-space:nowrap}
.ent-doc-strip .ent-val{width:19%}
.ent-section-title{font-size:7.5pt;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;background:#ececec;border:1px solid #333;border-bottom:none;padding:4px 6px;margin-top:10px}
.ent-meta-grid{display:grid;grid-template-columns:1fr 1fr;gap:0;margin-bottom:10px}
.ent-meta-table{width:100%;border-collapse:collapse;font-size:8pt}
.ent-meta-table td{border:1px solid #333;padding:3px 6px;vertical-align:top}
.ent-meta-table .ent-lbl{background:#ececec;font-weight:700;width:32%;white-space:nowrap}
.ent-items-table{width:100%;border-collapse:collapse;margin-bottom:10px;font-size:8pt}
.ent-items-table th,.ent-items-table td{border:1px solid #333;padding:4px 6px;vertical-align:top}
.ent-items-table thead th{background:#e8e8e8;font-weight:700;text-transform:uppercase;font-size:7pt;letter-spacing:0.3px}
.ent-items-table th.c,.ent-items-table td.c{text-align:center}
.ent-items-table th.r,.ent-items-table td.r{text-align:right}
.ent-items-table tbody tr{page-break-inside:avoid}
.ent-bottom{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-top:10px;margin-bottom:14px}
.ent-bottom-left{flex:1;min-width:0}
.ent-notes-block{border:1px solid #333;margin-bottom:8px}
.ent-notes-block .ent-notes-hdr{background:#ececec;font-size:7pt;font-weight:700;text-transform:uppercase;padding:3px 6px;border-bottom:1px solid #333}
.ent-notes-block .ent-notes-body{font-size:8pt;padding:6px;min-height:36px;white-space:pre-wrap;line-height:1.45}
.ent-summary-wrap{flex:0 0 240px}
.ent-summary-table{width:100%;border-collapse:collapse;font-size:8pt}
.ent-summary-table td{border:1px solid #333;padding:4px 7px}
.ent-summary-table .ent-lbl{background:#ececec;font-weight:700;text-align:left}
.ent-summary-table .ent-val{text-align:right;white-space:nowrap;font-family:'Courier New',Consolas,monospace}
.ent-summary-table tr.ent-total td{font-weight:700;font-size:9pt;border-top:2px solid #000;background:#f5f5f5}
.ent-signatures{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:16px;margin-bottom:10px}
.ent-signatures.cols-3{grid-template-columns:repeat(3,1fr)}
.ent-signatures.cols-2{grid-template-columns:repeat(2,1fr)}
.ent-sig{text-align:center;font-size:7pt}
.ent-sig-line{border-bottom:1px solid #000;height:32px;margin-bottom:4px}
.ent-sig-img{max-height:36px;max-width:120px;display:block;margin:0 auto 3px;object-fit:contain}
.ent-sig-label{font-weight:700;text-transform:uppercase;letter-spacing:0.2px}
.ent-sig-name{margin-top:2px;font-size:7pt;color:#333}
.ent-amount-words{border:1px solid #333;margin-top:8px;margin-bottom:10px;padding:6px 8px;font-size:8pt;background:#fafafa;line-height:1.45}
.ent-amount-words .ent-lbl{font-weight:700;text-transform:uppercase;font-size:7pt;margin-bottom:3px;color:#333}
.ent-amount-words .ent-text{font-style:italic;color:#111}
.ent-footer{border-top:1px solid #666;padding-top:6px;font-size:7pt;color:#333;text-align:center;line-height:1.5}
@media print{
  body{padding:10mm 12mm;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body.landscape{padding:8mm 10mm}
}
`.trim();

export interface EnterpriseDocMeta {
  label: string;
  value: string;
}

export interface EnterpriseMetaSection {
  title: string;
  rows: EnterpriseDocMeta[];
}

export interface PrintDocumentOptions {
  landscape?: boolean;
  theme?: 'modern' | 'enterprise';
  draftWatermark?: boolean;
}

export function renderEnterpriseHeader(
  b: Record<string, unknown>,
  docTitle: string,
  docMetaRows: EnterpriseDocMeta[],
): string {
  const logoUrl = b.logo_url ? String(b.logo_url) : '';
  const logoHtml = logoUrl
    ? `<img src="${logoUrl}" class="ent-logo" alt="" />`
    : `<div class="ent-logo-fallback">${String(b.business_name || 'DM').substring(0, 2).toUpperCase()}</div>`;

  const stripCells = docMetaRows.map((row) =>
    `<td class="ent-lbl">${row.label}</td><td class="ent-val">${row.value}</td>`
  ).join('');
  const padCount = Math.max(0, 8 - docMetaRows.length * 2);
  const padCells = padCount > 0 ? `<td class="ent-lbl" colspan="${padCount}"></td>` : '';

  return `
<div class="ent-header">
  <div class="ent-header-top">
    <div class="ent-company">
      ${logoHtml}
      <div>
        <div class="ent-company-name">${b.business_name || 'D METRAN TRADING'}</div>
        ${b.trade_name ? `<div class="ent-company-trade">${b.trade_name}</div>` : ''}
        <div class="ent-company-meta">
          ${renderCompanyContactLines(b)}
        </div>
      </div>
    </div>
    <div class="ent-doc-title">
      <h1>${docTitle}</h1>
      <div class="ent-doc-sub">${b.vat_type || 'VAT Registered'}</div>
    </div>
  </div>
  <table class="ent-doc-strip"><tr>${stripCells}${padCells}</tr></table>
</div>`;
}

export function renderEnterpriseMetaSections(sections: EnterpriseMetaSection[]): string {
  return `
<div class="ent-meta-grid">
  ${sections.map((sec) => `
  <div>
    <div class="ent-section-title">${sec.title}</div>
    <table class="ent-meta-table">
      ${sec.rows.map((row) => `
      <tr><td class="ent-lbl">${row.label}</td><td>${row.value}</td></tr>`).join('')}
    </table>
  </div>`).join('')}
</div>`;
}

export function renderEnterpriseItemsTable(headers: TableHeader[], bodyRows: string): string {
  const ths = headers.map((h) => {
    const cls = h.align === 'center' ? ' class="c"' : h.align === 'right' ? ' class="r"' : '';
    const style = h.width ? ` style="width:${h.width}"` : '';
    return `<th${cls}${style}>${h.text}</th>`;
  }).join('');
  const empty = `<tr><td colspan="${headers.length}" class="c" style="padding:12px;color:#666">No line items</td></tr>`;
  return `
<table class="ent-items-table">
  <thead><tr>${ths}</tr></thead>
  <tbody>${bodyRows || empty}</tbody>
</table>`;
}

export function renderEnterpriseSummaryTable(rows: { label: string; value: string; total?: boolean }[]): string {
  const trs = rows.map((r) =>
    `<tr${r.total ? ' class="ent-total"' : ''}><td class="ent-lbl">${r.label}</td><td class="ent-val">${r.value}</td></tr>`
  ).join('');
  return `<div class="ent-summary-wrap"><table class="ent-summary-table">${trs}</table></div>`;
}

export function renderEnterpriseNotesBlock(label: string, content: string): string {
  return `
<div class="ent-notes-block">
  <div class="ent-notes-hdr">${label}</div>
  <div class="ent-notes-body">${content || '—'}</div>
</div>`;
}

export function renderEnterpriseBottom(
  leftHtml: string,
  summaryRows: { label: string; value: string; total?: boolean }[],
): string {
  return `
<div class="ent-bottom">
  <div class="ent-bottom-left">${leftHtml}</div>
  ${renderEnterpriseSummaryTable(summaryRows)}
</div>`;
}

export function renderEnterpriseSignatures(
  labels: (string | { label: string; name?: string; imageUrl?: string })[],
  cols?: 2 | 3 | 4,
): string {
  const colCls = cols === 2 ? ' cols-2' : cols === 3 ? ' cols-3' : '';
  const blocks = labels.map((l) => {
    const label = typeof l === 'string' ? l : l.label;
    const name = typeof l === 'object' && l.name ? `<div class="ent-sig-name">${l.name}</div>` : '';
    const img = typeof l === 'object' && l.imageUrl ? `<img src="${l.imageUrl}" class="ent-sig-img" alt="" />` : '';
    return `<div class="ent-sig">${img}<div class="ent-sig-line"></div><div class="ent-sig-label">${label}</div>${name}</div>`;
  }).join('');
  return `<div class="ent-signatures${colCls}">${blocks}</div>`;
}

export function renderEnterpriseAmountInWords(amount: number): string {
  return `
<div class="ent-amount-words">
  <div class="ent-lbl">Amount in Words</div>
  <div class="ent-text">${formatAmountInWords(amount)}</div>
</div>`;
}

export function renderEnterpriseFooter(note?: string): string {
  const printed = new Date().toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
  const text = note || `System-generated document · Printed ${printed}`;
  return `<div class="ent-footer">${text}</div>`;
}

export function renderEnterpriseSectionTitle(title: string): string {
  return `<div class="ent-section-title">${title}</div>`;
}

export function renderEnterpriseAgingRow(aging: Record<string, number>): string {
  const buckets = [
    { key: 'current', label: 'Current' },
    { key: 'd30', label: '1–30 Days' },
    { key: 'd60', label: '31–60 Days' },
    { key: 'd90', label: '61–90 Days' },
    { key: 'over90', label: '90+ Days' },
  ];
  const cells = buckets.map((b) =>
    `<td class="ent-lbl">${b.label}</td><td class="ent-val">${fmtCurrency(aging[b.key] || 0)}</td>`
  ).join('');
  return `
<table class="ent-doc-strip" style="margin-top:10px">
  <tr>${cells}</tr>
</table>`;
}

export function renderEnterpriseTotalBanner(label: string, value: string): string {
  return `
<table class="ent-summary-table" style="margin-top:10px;margin-left:auto;width:300px">
  <tr class="ent-total"><td class="ent-lbl">${label}</td><td class="ent-val">${value}</td></tr>
</table>`;
}

export function buildPrintDocument(title: string, body: string, options: boolean | PrintDocumentOptions = false): string {
  const opts: PrintDocumentOptions = typeof options === 'boolean' ? { landscape: options } : options;
  const classes = [
    opts.landscape ? 'landscape' : '',
    opts.theme === 'enterprise' && opts.draftWatermark ? 'ent-draft' : '',
  ].filter(Boolean).join(' ');
  const bodyCls = classes ? ` class="${classes}"` : '';
  const css = opts.theme === 'enterprise' ? PRINT_CSS_ENTERPRISE : PRINT_CSS;
  const autoprintScript = `<script>(function(){if(![?&]autoprint=1(?:&|$)/.test(location.search))return;function p(){try{window.focus();window.print();}catch(e){}}if(document.readyState==='complete')setTimeout(p,400);else window.addEventListener('load',function(){setTimeout(p,400);});})();</script>`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${title}</title>
<style>${css}</style></head><body${bodyCls}>
${body}
${autoprintScript}
</body></html>`;
}
