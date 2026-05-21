// Run the real pdfjs inspect/extract path inside Electron's main process to
// reproduce the "DOMMatrix is not defined" error. Usage:
//   node_modules/.bin/electron scripts/probe-electron-extract.mjs <pdf>
import { app } from 'electron';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const requireFromHere = createRequire(import.meta.url);

async function main() {
  await app.whenReady();
  const path = process.argv[2];
  console.log('[probe] DOMMatrix global:', typeof globalThis.DOMMatrix);
  console.log('[probe] node:', process.versions.node, 'electron:', process.versions.electron);

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = requireFromHere.resolve(
    'pdfjs-dist/legacy/build/pdf.worker.mjs',
  );

  const buf = await readFile(path);
  const data = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true, disableFontFace: true })
    .promise;
  console.log('[probe] pages:', doc.numPages);

  try {
    for (let i = 1; i <= 3; i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      console.log(`[probe] page ${i}: ${tc.items.length} items`);
      page.cleanup();
    }
    console.log('[probe] getTextContent OK — no DOMMatrix error');
    app.exit(0);
  } catch (err) {
    console.error('[probe] FAILED:', err?.message ?? err);
    app.exit(2);
  }
}

main().catch((err) => {
  console.error('[probe] fatal', err);
  app.exit(3);
});
