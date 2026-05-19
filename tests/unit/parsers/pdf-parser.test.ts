import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PdfParser } from '@main/parsers/pdf/pdf-parser';
import { makeMinimalPdf } from '../../fixtures/make-pdf';

describe('PdfParser', () => {
  let tmpDir: string;
  let parser: PdfParser;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'nb-pdfparser-'));
    parser = new PdfParser();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('claims .pdf extension and application/pdf mime', () => {
    expect(parser.supports({ extension: '.pdf' })).toBe(true);
    expect(parser.supports({ extension: '.PDF' })).toBe(true);
    expect(parser.supports({ extension: '.xlsx' })).toBe(false);
    expect(parser.supports({ extension: '.bin', mimeType: 'application/pdf' })).toBe(true);
  });

  it('inspects a tiny valid PDF and reports page count + text layer', async () => {
    const path = join(tmpDir, 'simple.pdf');
    writeFileSync(path, makeMinimalPdf({ text: 'Inspect me' }));

    const inspection = await parser.inspect({ filePath: path });

    expect(inspection.documentKind).toBe('pdf');
    expect(inspection.isEncrypted).toBe(false);
    expect(inspection.pageCount).toBe(1);
    expect(inspection.hasTextLayer).toBe(true);
    expect(inspection.needsOcr).toBe(false);
  });

  it('throws on a malformed PDF body', async () => {
    const path = join(tmpDir, 'bad.pdf');
    writeFileSync(path, '%PDF-1.4\nnot a real pdf\n%%EOF\n');
    await expect(parser.inspect({ filePath: path })).rejects.toThrow();
  });
});
