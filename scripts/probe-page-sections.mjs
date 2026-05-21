// Per-page histogram of CSI section numbers found in page text.
// Helps decide whether content pages carry a dominant running-header section no.
// Usage: node scripts/probe-page-sections.mjs <pdf> <fromPage> <toPage>
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const requireFromHere = createRequire(import.meta.url);
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
pdfjs.GlobalWorkerOptions.workerSrc = requireFromHere.resolve(
  'pdfjs-dist/legacy/build/pdf.worker.mjs',
);

const path = process.argv[2];
const from = Number(process.argv[3] ?? 1);
const to = Number(process.argv[4] ?? from);
const buf = await readFile(path);
const data = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
const doc = await pdfjs.getDocument({ data, useSystemFonts: true, disableFontFace: true }).promise;

const SECTION_RE = /\bSECTION\s+(\d{2}(?:\s+\d{2}){1,3})\b/gi;

for (let p = from; p <= Math.min(to, doc.numPages); p++) {
  const page = await doc.getPage(p);
  const tc = await page.getTextContent();
  const text = tc.items.map((it) => ('str' in it ? it.str : '')).join(' ');
  const counts = new Map();
  let m;
  SECTION_RE.lastIndex = 0;
  while ((m = SECTION_RE.exec(text))) {
    const no = m[1].replace(/\s+/g, ' ');
    counts.set(no, (counts.get(no) ?? 0) + 1);
  }
  const distinct = counts.size;
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const firstWords = text.trim().slice(0, 70).replace(/\s+/g, ' ');
  console.log(`p${p}: distinct=${distinct} top=${JSON.stringify(top)} | ${firstWords}`);
  page.cleanup();
}

await doc.cleanup();
await doc.destroy();
