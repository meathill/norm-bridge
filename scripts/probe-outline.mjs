// Probe a PDF for embedded outline (bookmarks) + sniff likely TOC pages.
// Usage: node scripts/probe-outline.mjs <path-to-pdf>
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const requireFromHere = createRequire(import.meta.url);
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
pdfjs.GlobalWorkerOptions.workerSrc = requireFromHere.resolve(
  'pdfjs-dist/legacy/build/pdf.worker.mjs',
);

const path = process.argv[2];
if (!path) {
  console.error('usage: node scripts/probe-outline.mjs <pdf>');
  process.exit(1);
}

const buf = await readFile(path);
const data = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
const doc = await pdfjs.getDocument({ data, useSystemFonts: true, disableFontFace: true }).promise;

console.log('pages:', doc.numPages);

const outline = await doc.getOutline();
if (!outline || outline.length === 0) {
  console.log('OUTLINE: none (PDF has no embedded bookmarks)');
} else {
  console.log(`OUTLINE: ${outline.length} top-level entries`);
  let resolved = 0;
  let failed = 0;

  async function pageOf(item) {
    try {
      let dest = item.dest;
      if (typeof dest === 'string') dest = await doc.getDestination(dest);
      if (!Array.isArray(dest) || !dest[0]) return null;
      const idx = await doc.getPageIndex(dest[0]);
      return idx + 1;
    } catch {
      return null;
    }
  }

  async function walk(items, depth) {
    for (const it of items) {
      const page = await pageOf(it);
      if (page) resolved++;
      else failed++;
      if (depth <= 1) {
        console.log(`${'  '.repeat(depth)}- [p${page ?? '?'}] ${it.title}`);
      }
      if (it.items && it.items.length > 0) await walk(it.items, depth + 1);
    }
  }
  await walk(outline, 0);
  console.log(`\nresolved page refs: ${resolved}, failed: ${failed}`);
}

// Sniff printed TOC: scan first 40 pages for "Contents"/"目录" + dotted leaders.
console.log('\n--- printed TOC sniff (first 40 pages) ---');
const maxScan = Math.min(40, doc.numPages);
for (let i = 1; i <= maxScan; i++) {
  const page = await doc.getPage(i);
  const tc = await page.getTextContent();
  const text = tc.items.map((it) => ('str' in it ? it.str : '')).join(' ');
  const lower = text.toLowerCase();
  const hasHeading = /\b(contents|table of contents)\b/.test(lower) || text.includes('目录');
  // Dotted leaders like "....... 12" are a strong TOC signal.
  const dotLeaders = (text.match(/\.{4,}\s*\d+/g) || []).length;
  if (hasHeading || dotLeaders >= 3) {
    console.log(`page ${i}: heading=${hasHeading} dotLeaders=${dotLeaders}`);
  }
  page.cleanup();
}

await doc.cleanup();
await doc.destroy();
