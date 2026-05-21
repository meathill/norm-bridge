// Replicate PdfParser.getSectionMap parse on a real PDF to sanity-check ranges.
// Usage: node scripts/probe-sectionmap.mjs <pdf>
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const requireFromHere = createRequire(import.meta.url);
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
pdfjs.GlobalWorkerOptions.workerSrc = requireFromHere.resolve(
  'pdfjs-dist/legacy/build/pdf.worker.mjs',
);

const SECTION_TOC_RE = /SECTION\s+(\d{2})\s*(\d{2})\s*(\d{2})(\d{1,4})/g;

function reconstructLines(items) {
  const lines = new Map();
  for (const it of items) {
    if (typeof it.str !== 'string' || !it.str.trim() || !it.transform) continue;
    const y = Math.round(it.transform[5]);
    const arr = lines.get(y) ?? [];
    arr.push(it.str);
    lines.set(y, arr);
  }
  return [...lines.entries()].sort((a, b) => b[0] - a[0]).map(([, p]) => p.join(''));
}

const path = process.argv[2];
const buf = await readFile(path);
const data = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
const doc = await pdfjs.getDocument({ data, useSystemFonts: true, disableFontFace: true }).promise;
const numPages = doc.numPages;

const byClause = new Map();
for (let p = 1; p <= Math.min(20, numPages); p++) {
  const page = await doc.getPage(p);
  const tc = await page.getTextContent();
  for (const line of reconstructLines(tc.items)) {
    SECTION_TOC_RE.lastIndex = 0;
    let m;
    while ((m = SECTION_TOC_RE.exec(line))) {
      const clauseNo = `${m[1]} ${m[2]} ${m[3]}`;
      const pageNo = Number.parseInt(m[4], 10);
      if (pageNo >= 1 && pageNo <= numPages && !byClause.has(clauseNo)) {
        byClause.set(clauseNo, pageNo);
      }
    }
  }
  page.cleanup();
}

const sorted = [...byClause.entries()].map(([c, p]) => ({ c, p })).sort((a, b) => a.p - b.p);
console.log(`parsed sections: ${sorted.length}, numPages: ${numPages}`);
for (let i = 0; i < sorted.length; i++) {
  const cur = sorted[i];
  const next = sorted[i + 1];
  const end = next ? next.p - 1 : numPages;
  console.log(`  ${cur.c}  p${cur.p}-${end}  (${end - cur.p + 1}p)`);
}

await doc.cleanup();
await doc.destroy();
