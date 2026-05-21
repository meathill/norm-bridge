// Dump CSI-style SECTION entries from the outline: clauseNo -> resolved page(s).
// Usage: node scripts/probe-sections.mjs <pdf>
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const requireFromHere = createRequire(import.meta.url);
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
pdfjs.GlobalWorkerOptions.workerSrc = requireFromHere.resolve(
  'pdfjs-dist/legacy/build/pdf.worker.mjs',
);

const path = process.argv[2];
const buf = await readFile(path);
const data = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
const doc = await pdfjs.getDocument({ data, useSystemFonts: true, disableFontFace: true }).promise;
const outline = await doc.getOutline();

async function pageOf(item) {
  try {
    let dest = item.dest;
    if (typeof dest === 'string') dest = await doc.getDestination(dest);
    if (!Array.isArray(dest) || !dest[0]) return null;
    return (await doc.getPageIndex(dest[0])) + 1;
  } catch {
    return null;
  }
}

const SECTION_RE = /\bSECTION\s+(\d{2}(?:\s+\d{2}){1,3})\b/i;
const NUMBERED_RE = /^(\d+(?:\.\d+){0,4})\s+(.{2,})/;

const flat = [];
async function walk(items, depth) {
  for (const it of items) {
    const page = await pageOf(it);
    flat.push({ title: (it.title ?? '').trim(), page, depth });
    if (it.items?.length) await walk(it.items, depth + 1);
  }
}
await walk(outline ?? [], 0);

console.log('total outline entries:', flat.length);

// CSI sections
const csi = new Map();
for (const e of flat) {
  const m = SECTION_RE.exec(e.title);
  if (m && e.page) {
    const no = m[1].replace(/\s+/g, ' ');
    const prev = csi.get(no);
    // keep the largest page (real content page, not the TOC listing)
    if (!prev || e.page > prev) csi.set(no, e.page);
  }
}
console.log('\n=== CSI SECTION entries (deduped, max page) ===', csi.size);
const sorted = [...csi.entries()].sort((a, b) => a[1] - b[1]);
for (const [no, page] of sorted.slice(0, 60)) console.log(`  ${no} -> p${page}`);

// Numbered headings (fallback)
const numbered = flat.filter((e) => e.page && NUMBERED_RE.test(e.title));
console.log('\n=== numbered-heading entries (fallback) ===', numbered.length);
for (const e of numbered.slice(0, 15)) console.log(`  [p${e.page} d${e.depth}] ${e.title}`);

await doc.cleanup();
await doc.destroy();
