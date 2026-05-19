/**
 * pdfjs returns text positions in PDF page coordinates: origin at the
 * page's lower-left, y growing upward, units in 1/72 inch by default.
 * Our citation model (TECH_SPEC §10) uses top-left origin in PDF units so
 * the renderer can overlay highlights without per-page math.
 *
 * This module is the one place that knows about both conventions.
 */

export type PdfPageView = {
  /** MediaBox-style rectangle [x1, y1, x2, y2] in PDF units. */
  view: readonly number[];
  /** Page rotation in degrees: one of 0, 90, 180, 270 (or any multiple of 90). */
  rotation: number;
};

export type PdfTextItemLike = {
  /** 6-element affine transform matrix [a, b, c, d, e, f]. */
  transform: readonly number[];
  /** Visual width of the text run in PDF units. */
  width: number;
  /** Visual height of the text run in PDF units. */
  height: number;
};

export type TopLeftBbox = {
  x: number;
  y: number;
  w: number;
  h: number;
};

function normalizeRotation(rotation: number): 0 | 90 | 180 | 270 {
  const r = (((rotation ?? 0) % 360) + 360) % 360;
  if (r === 0 || r === 90 || r === 180 || r === 270) return r;
  return 0;
}

/**
 * Logical page dimensions after rotation. Useful for sizing the renderer view
 * so that 0/180-rotated pages keep their natural width × height and 90/270
 * pages swap them.
 */
export function pageDimensions(page: PdfPageView): { width: number; height: number } {
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = page.view;
  const w = x2 - x1;
  const h = y2 - y1;
  return normalizeRotation(page.rotation) % 180 === 0
    ? { width: w, height: h }
    : { width: h, height: w };
}

/**
 * Convert a pdfjs text item's bottom-left bbox into a top-left bbox in the
 * page's logical coordinate frame (i.e. after rotation has been applied).
 */
export function textItemToTopLeftBbox(item: PdfTextItemLike, page: PdfPageView): TopLeftBbox {
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = page.view;
  const pageW = x2 - x1;
  const pageH = y2 - y1;
  const [, , , , rawX = 0, rawY = 0] = item.transform;
  const blX = rawX - x1;
  const blY = rawY - y1;
  const itemW = item.width;
  const itemH = item.height;

  switch (normalizeRotation(page.rotation)) {
    case 0:
      return { x: blX, y: pageH - (blY + itemH), w: itemW, h: itemH };
    case 90:
      return { x: pageH - (blY + itemH), y: blX, w: itemH, h: itemW };
    case 180:
      return { x: pageW - (blX + itemW), y: blY, w: itemW, h: itemH };
    case 270:
      return { x: blY, y: pageW - (blX + itemW), w: itemH, h: itemW };
  }
}
