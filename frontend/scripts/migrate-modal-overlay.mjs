/**
 * Replaces modal backdrop divs with ModalOverlay component.
 * Run: node scripts/migrate-modal-overlay.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.join(__dirname, '..', 'src');

const OPEN_PATTERNS = [
  /<div className="modal-overlay" onClick=\{/g,
  /<div className="fixed inset-0 z-\[60\] bg-black\/50 flex items-center justify-center p-4" onClick=\{/g,
  /<div className="fixed inset-0 bg-black\/50 flex items-center justify-center z-50" onClick=\{/g,
];

function importPath(fromFile) {
  const rel = path.relative(path.dirname(fromFile), path.join(srcRoot, 'components', 'ModalOverlay')).replace(/\\/g, '/');
  return rel.startsWith('.') ? rel : `./${rel}`;
}

function extractHandler(content, startIdx, prefixLen) {
  let j = startIdx + prefixLen;
  let depth = 1;
  while (j < content.length && depth > 0) {
    const ch = content[j];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    j++;
  }
  return {
    handler: content.slice(startIdx + prefixLen, j - 1),
    endIdx: content[j] === '>' ? j + 1 : j,
  };
}

function findOverlayClose(content, openEndIdx) {
  let depth = 1;
  let i = openEndIdx;
  const divOpen = /<div[\s>]/g;
  const divClose = /<\/div>/g;

  while (i < content.length && depth > 0) {
    divOpen.lastIndex = i;
    divClose.lastIndex = i;
    const nextOpen = divOpen.exec(content);
    const nextClose = divClose.exec(content);

    if (!nextClose) break;

    if (nextOpen && nextOpen.index < nextClose.index) {
      depth++;
      i = nextOpen.index + nextOpen[0].length;
    } else {
      depth--;
      if (depth === 0) {
        return nextClose.index;
      }
      i = nextClose.index + nextClose[0].length;
    }
  }
  return -1;
}

function extraClassForMatch(matched) {
  if (matched.includes('z-[60]')) return 'z-[60] p-4';
  return undefined;
}

function transformFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  if (!content.includes('onClick={') && !content.includes('onClick={')) return false;
  if (!content.includes('modal-overlay') && !content.includes('fixed inset-0')) return false;

  let changed = false;
  let searchFrom = 0;

  while (searchFrom < content.length) {
    let best = null;
    for (const pattern of OPEN_PATTERNS) {
      pattern.lastIndex = searchFrom;
      const m = pattern.exec(content);
      if (m && (!best || m.index < best.index)) {
        best = { match: m, pattern: pattern.source, prefixLen: m[0].length, index: m.index };
      }
    }
    if (!best) break;

    const { handler, endIdx } = extractHandler(content, best.index, best.prefixLen);
    const extraClass = extraClassForMatch(content.slice(best.index, endIdx));
    const classProp = extraClass ? ` className="${extraClass}"` : '';
    const replacement = `<ModalOverlay onClose={${handler}}${classProp}>`;

    const closeIdx = findOverlayClose(content, endIdx);
    if (closeIdx === -1) {
      searchFrom = endIdx;
      continue;
    }

    content = content.slice(0, best.index) + replacement + content.slice(endIdx, closeIdx) + '</ModalOverlay>' + content.slice(closeIdx + 6);
    changed = true;
    searchFrom = best.index + replacement.length;
  }

  if (!changed) return false;

  if (!content.includes("from '../components/ModalOverlay'") && !content.includes('from "../components/ModalOverlay"')) {
    const imp = importPath(filePath);
    const importLine = `import ModalOverlay from '${imp.replace(/\.tsx$/, '')}';\n`;
    const reactImport = content.match(/^import React[^\n]*\n/m);
    if (reactImport) {
      content = content.replace(reactImport[0], reactImport[0] + importLine);
    } else {
      content = importLine + content;
    }
  }

  // Remove redundant stopPropagation on modal-content (optional cleanup)
  content = content.replace(/\s+onClick=\{\(e\) => e\.stopPropagation\(\)\}/g, '');
  content = content.replace(/\s+onClick=\{e => e\.stopPropagation\(\)\}/g, '');

  fs.writeFileSync(filePath, content, 'utf8');
  return true;
}

function walk(dir) {
  const files = [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) files.push(...walk(p));
    else if (p.endsWith('.tsx')) files.push(p);
  }
  return files;
}

const files = walk(srcRoot);
let count = 0;
for (const f of files) {
  if (transformFile(f)) {
    console.log('Updated', path.relative(srcRoot, f));
    count++;
  }
}
console.log(`Done. ${count} file(s) updated.`);
