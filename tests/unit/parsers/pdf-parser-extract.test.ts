import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PdfParser } from '@main/parsers/pdf/pdf-parser';
import { makeMinimalPdf } from '../../fixtures/make-pdf';

describe('PdfParser.extract', () => {
  let tmpDir: string;
  let parser: PdfParser;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'nb-pdfextract-'));
    parser = new PdfParser();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns pages + at least one text block for a tiny PDF', async () => {
    const path = join(tmpDir, 'simple.pdf');
    writeFileSync(path, makeMinimalPdf({ text: 'Extract me please' }));

    const data = await parser.extract({ filePath: path, sourceId: 'src_demo' });

    expect(data.sourceId).toBe('src_demo');
    expect(data.pages).toHaveLength(1);

    const p1 = data.pages[0];
    expect(p1?.page).toBe(1);
    expect(p1?.width).toBeGreaterThan(0);
    expect(p1?.height).toBeGreaterThan(0);
    expect(p1?.textBlockCount).toBeGreaterThan(0);

    const block = data.textBlocks[0];
    expect(block?.page).toBe(1);
    expect(block?.text).toContain('Extract');
    expect(block?.id).toMatch(/^cit_/);
    expect(block?.bbox.y).toBeGreaterThanOrEqual(0);
    expect(block?.readingOrder).toBe(0);
  });

  it('emits onProgress for every page', async () => {
    const path = join(tmpDir, 'progress.pdf');
    writeFileSync(path, makeMinimalPdf());

    const seen: Array<{ page: number; totalPages: number }> = [];
    await parser.extract({
      filePath: path,
      sourceId: 'src_p',
      onProgress: (p) => seen.push(p),
    });

    expect(seen).toEqual([{ page: 1, totalPages: 1 }]);
  });
});
