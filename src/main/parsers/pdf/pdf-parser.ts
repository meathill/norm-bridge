import { readFile } from 'node:fs/promises';
import type { PdfInspection } from '@shared/domain/inspection';
import type {
  DocumentParser,
  ParserInspectInput,
  ParserSupportInput,
} from '@main/parsers/document-parser';

const PDF_EXT = new Set(['.pdf']);
const PDF_MIME = new Set(['application/pdf', 'application/x-pdf']);

/**
 * pdfjs-dist 5.x legacy build, loaded lazily so importing this module is cheap
 * (the actual ESM is several hundred KB).
 *
 * In Node / Electron main we use pdfjs's "fake worker" mode: pdfjs still needs
 * `workerSrc` set so it can load the worker JS into the same thread. Resolving via
 * createRequire keeps the path correct under both pnpm symlinks and bundled output.
 */
async function loadPdfjs() {
  const { createRequire } = await import('node:module');
  const requireFromHere = createRequire(import.meta.url);
  const workerPath = requireFromHere.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
  const mod = await import('pdfjs-dist/legacy/build/pdf.mjs');
  mod.GlobalWorkerOptions.workerSrc = workerPath;
  return mod;
}

/**
 * Detect whether a thrown error came from a password-protected PDF.
 * pdfjs throws PasswordException with a `code` matching PasswordResponses.NEED_PASSWORD.
 */
function isPasswordError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; code?: number; message?: string };
  if (e.name === 'PasswordException') return true;
  // pdfjs has code 1 = NEED_PASSWORD, 2 = INCORRECT_PASSWORD.
  if (e.code === 1 || e.code === 2) return true;
  if (e.message && /password/i.test(e.message)) return true;
  return false;
}

export class PdfParser implements DocumentParser {
  readonly name = 'pdf';

  supports({ extension, mimeType }: ParserSupportInput): boolean {
    if (mimeType && PDF_MIME.has(mimeType.toLowerCase())) return true;
    return PDF_EXT.has(extension.toLowerCase());
  }

  async inspect({ filePath }: ParserInspectInput): Promise<PdfInspection> {
    const fileBuffer = await readFile(filePath);
    const pdfjs = await loadPdfjs();

    const warnings: string[] = [];
    const data = new Uint8Array(fileBuffer.buffer, fileBuffer.byteOffset, fileBuffer.byteLength);

    let doc: Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>;
    try {
      const task = pdfjs.getDocument({
        data,
        useSystemFonts: true,
        disableFontFace: true,
      });
      doc = await task.promise;
    } catch (err) {
      if (isPasswordError(err)) {
        return {
          documentKind: 'pdf',
          isEncrypted: true,
          hasTextLayer: false,
          pageCount: 0,
          needsOcr: false,
          warnings: ['PDF is encrypted; v0.1 does not prompt for password.'],
        };
      }
      throw err;
    }

    const pageCount = doc.numPages;
    const sampleCount = Math.min(3, pageCount);
    let nonEmptyTextSeen = false;

    for (let i = 1; i <= sampleCount; i++) {
      try {
        const page = await doc.getPage(i);
        const text = await page.getTextContent();
        if (text.items.length > 0) {
          nonEmptyTextSeen = true;
        }
        page.cleanup();
      } catch (err) {
        warnings.push(`Failed to read page ${i}: ${(err as Error).message ?? 'unknown'}`);
      }
    }

    await doc.cleanup();
    await doc.destroy();

    const hasTextLayer = nonEmptyTextSeen;
    const needsOcr = !hasTextLayer;
    if (needsOcr) {
      warnings.push(
        `No text layer detected in the first ${sampleCount} page(s); OCR is required for extraction.`,
      );
    }

    return {
      documentKind: 'pdf',
      isEncrypted: false,
      hasTextLayer,
      pageCount,
      needsOcr,
      warnings,
    };
  }
}
