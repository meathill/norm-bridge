/**
 * Structured PDF extraction artifacts. All bounding boxes are in PDF units
 * with a top-left origin (see src/main/parsers/pdf/pdf-coords.ts).
 */

export type Bbox = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type PdfPageInfo = {
  page: number;
  width: number;
  height: number;
  rotation: number;
  textBlockCount: number;
};

export type PdfTextBlock = {
  id: string;
  page: number;
  text: string;
  bbox: Bbox;
  readingOrder: number;
  fontHint?: string;
};

export type PdfExtractData = {
  sourceId: string;
  pages: PdfPageInfo[];
  textBlocks: PdfTextBlock[];
};

export type PdfExtractProgress = {
  page: number;
  totalPages: number;
};
