import { beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PdfParser } from '@main/parsers/pdf/pdf-parser';
import { makeMinimalPdf } from '../../fixtures/make-pdf';

/**
 * Regression guard for the Node-side DOM polyfills loaded by PdfParser.
 * v0.1 had a `ReferenceError: DOMMatrix is not defined` crash when running pdfjs
 * in Electron main on real-world standard PDFs (V05_General Specifications.pdf).
 */
describe('PdfParser DOM polyfills (DOMMatrix / Path2D / ImageData)', () => {
  let tmpDir: string;
  let parser: PdfParser;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'nb-domms-'));
    parser = new PdfParser();
    // Force pdfjs to load so the polyfills get installed on globalThis.
    const path = join(tmpDir, 'tiny.pdf');
    writeFileSync(path, makeMinimalPdf({ text: 'Hi' }));
    await parser.inspect({ filePath: path });
  });

  it('installs globalThis.DOMMatrix with mutating methods used by pdfjs', () => {
    const g = globalThis as unknown as {
      DOMMatrix?: new () => {
        scaleSelf(sx: number, sy: number): unknown;
        translateSelf(tx: number, ty: number): unknown;
        a: number;
        d: number;
        e: number;
        f: number;
      };
    };
    expect(typeof g.DOMMatrix).toBe('function');
    const ctor = g.DOMMatrix!;
    const m = new ctor();
    // Exactly the call pattern pdfjs uses in worker: new DOMMatrix().scaleSelf(...).translateSelf(...)
    m.scaleSelf(1 / 100, -1 / 200).translateSelf(0, -200);
    expect(m.a).toBeCloseTo(1 / 100);
    expect(m.d).toBeCloseTo(-1 / 200);
  });

  it('installs Path2D and ImageData globals', () => {
    const g = globalThis as unknown as { Path2D?: unknown; ImageData?: unknown };
    expect(typeof g.Path2D).toBe('function');
    expect(typeof g.ImageData).toBe('function');
  });

  it('cleanup', () => {
    rmSync(tmpDir, { recursive: true, force: true });
    expect(true).toBe(true);
  });
});
