import { extname } from 'node:path';
import type { DocumentParser, ParserSupportInput } from './document-parser';
import { PdfParser } from './pdf/pdf-parser';

export class ParserRegistry {
  private readonly parsers: DocumentParser[];

  constructor(parsers?: DocumentParser[]) {
    this.parsers = parsers ?? [new PdfParser()];
  }

  resolve(filePath: string, mimeType?: string): DocumentParser | null {
    const support: ParserSupportInput = {
      extension: extname(filePath).toLowerCase(),
      ...(mimeType ? { mimeType } : {}),
    };
    return this.parsers.find((p) => p.supports(support)) ?? null;
  }

  requirePdf(): DocumentParser {
    const p = this.parsers.find((p) => p.name === 'pdf');
    if (!p) throw new Error('PdfParser is not registered');
    return p;
  }
}
