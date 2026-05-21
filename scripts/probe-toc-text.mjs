// Dump raw text of given pages (to inspect printed TOC structure).
// Usage: node scripts/probe-toc-text.mjs <pdf> <fromPage> <toPage>
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

for (let p = from; p <= Math.min(to, doc.numPages); p++) {
  const page = await doc.getPage(p);
  const tc = await page.getTextContent();
  // Reconstruct lines using the y coordinate of each item.
  const lines = new Map();
  for (const it of tc.items) {
    if (!('str' in it) || !it.str.trim()) continue;
    const y = Math.round(it.transform[5]);
    const arr = lines.get(y) ?? [];
    arr.push(it.str);
    lines.set(y, arr);
  }
  const ordered = [...lines.entries()].sort((a, b) => b[0] - a[0]);
  console.log(`\n========== PAGE ${p} ==========`);
  for (const [, parts] of ordered) {
    const line = parts.join('').replace(/\s+/g, ' ').trim();
    if (line) console.log(line);
  }
  page.cleanup();
}

await doc.cleanup();
await doc.destroy();
