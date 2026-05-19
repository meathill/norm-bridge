/**
 * Document inspection result. TECH_SPEC §6.2 — DocumentInspection.
 * v0.1 only fills the fields relevant to the document kind; the rest stay undefined.
 */
export type DocumentKind = 'pdf' | 'workbook' | 'word' | 'csv' | 'unknown';

export type DocumentInspection = {
  documentKind: DocumentKind;
  isEncrypted: boolean;
  hasTextLayer?: boolean;
  pageCount?: number;
  sheetCount?: number;
  needsOcr?: boolean;
  warnings: string[];
};

export type PdfInspection = DocumentInspection & {
  documentKind: 'pdf';
  pageCount: number;
};
