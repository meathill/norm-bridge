import { readFile } from 'node:fs/promises';
import { newId } from '@shared/ids';
import type { PdfInspection } from '@shared/domain/inspection';
import type {
  PdfExtractData,
  PdfExtractProgress,
  PdfPageInfo,
  PdfTextBlock,
} from '@shared/domain/pdf-extract';
import type {
  DocumentParser,
  ParserInspectInput,
  ParserSupportInput,
} from '@main/parsers/document-parser';
import { pageDimensions, textItemToTopLeftBbox } from './pdf-coords';

const PDF_EXT = new Set(['.pdf']);
const PDF_MIME = new Set(['application/pdf', 'application/x-pdf']);

/**
 * pdfjs-dist 5.x legacy build, loaded lazily so importing this module is cheap
 * (the actual ESM is several hundred KB).
 *
 * In Node / Electron main we use pdfjs's "fake worker" mode: pdfjs still needs
 * `workerSrc` set so it can load the worker JS into the same thread. Resolving via
 * createRequire keeps the path correct under both pnpm symlinks and bundled output.
 *
 * We also polyfill DOMMatrix / Path2D on globalThis before the worker module loads
 * — both are referenced when pdfjs parses annotations, images, or transforms, and
 * Node has neither. The polyfills are pure JS, no native dependencies.
 */
let polyfillsInstalled = false;

async function installDomPolyfills(): Promise<void> {
  if (polyfillsInstalled) return;
  const g = globalThis as unknown as {
    DOMMatrix?: unknown;
    DOMMatrixReadOnly?: unknown;
    Path2D?: unknown;
    ImageData?: unknown;
  };
  if (typeof g.DOMMatrix === 'undefined') {
    const mod = await import('@thednp/dommatrix');
    const DOMMatrixCtor = (mod as { default: unknown }).default;
    g.DOMMatrix = DOMMatrixCtor;
    g.DOMMatrixReadOnly = DOMMatrixCtor;
  }
  if (typeof g.Path2D === 'undefined') {
    const { Path2D } = await import('path2d');
    g.Path2D = Path2D;
  }
  if (typeof g.ImageData === 'undefined') {
    // Minimal stub: pdfjs only `new ImageData(width, height)` and reads `data`.
    g.ImageData = class ImageData {
      readonly data: Uint8ClampedArray;
      readonly width: number;
      readonly height: number;
      constructor(...args: unknown[]) {
        const [first, second, third] = args as [
          number | Uint8ClampedArray,
          number,
          number | undefined,
        ];
        if (first instanceof Uint8ClampedArray) {
          this.data = first;
          this.width = second;
          this.height = third ?? this.data.length / 4 / second;
        } else {
          this.width = first;
          this.height = second;
          this.data = new Uint8ClampedArray(first * second * 4);
        }
      }
    };
  }
  polyfillsInstalled = true;
}

async function loadPdfjs() {
  await installDomPolyfills();
  const { createRequire } = await import('node:module');
  const requireFromHere = createRequire(import.meta.url);
  const workerPath = requireFromHere.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
  const mod = await import('pdfjs-dist/legacy/build/pdf.mjs');
  mod.GlobalWorkerOptions.workerSrc = workerPath;
  return mod;
}

function isPasswordError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; code?: number; message?: string };
  if (e.name === 'PasswordException') return true;
  if (e.code === 1 || e.code === 2) return true;
  if (e.message && /password/i.test(e.message)) return true;
  return false;
}

export type PdfExtractInput = {
  filePath: string;
  sourceId: string;
  onProgress?: (p: PdfExtractProgress) => void;
};

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

  async extract({ filePath, sourceId, onProgress }: PdfExtractInput): Promise<PdfExtractData> {
    const fileBuffer = await readFile(filePath);
    const pdfjs = await loadPdfjs();
    const data = new Uint8Array(fileBuffer.buffer, fileBuffer.byteOffset, fileBuffer.byteLength);

    const task = pdfjs.getDocument({
      data,
      useSystemFonts: true,
      disableFontFace: true,
    });
    const doc = await task.promise;
    const pageCount = doc.numPages;

    const pages: PdfPageInfo[] = [];
    const textBlocks: PdfTextBlock[] = [];

    for (let pageNo = 1; pageNo <= pageCount; pageNo++) {
      const page = await doc.getPage(pageNo);
      const view = page.view;
      const rotation = page.rotate ?? 0;
      const pageView = { view, rotation };
      const { width, height } = pageDimensions(pageView);

      const text = await page.getTextContent();
      let order = 0;
      let blockCount = 0;
      for (const item of text.items) {
        // Marked-content boundaries appear as items without transform; ignore them.
        const t = item as {
          transform?: number[];
          width?: number;
          height?: number;
          str?: string;
          fontName?: string;
        };
        if (!t.transform || typeof t.str !== 'string' || t.str.length === 0) continue;
        const bbox = textItemToTopLeftBbox(
          { transform: t.transform, width: t.width ?? 0, height: t.height ?? 0 },
          pageView,
        );
        textBlocks.push({
          id: newId('citation'),
          page: pageNo,
          text: t.str,
          bbox,
          readingOrder: order++,
          ...(t.fontName ? { fontHint: t.fontName } : {}),
        });
        blockCount++;
      }

      pages.push({
        page: pageNo,
        width,
        height,
        rotation,
        textBlockCount: blockCount,
      });

      page.cleanup();
      if (onProgress) {
        onProgress({ page: pageNo, totalPages: pageCount });
      }
    }

    await doc.cleanup();
    await doc.destroy();

    return { sourceId, pages, textBlocks };
  }
}
