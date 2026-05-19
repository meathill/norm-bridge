import { describe, expect, it } from 'vitest';
import {
  pageDimensions,
  textItemToTopLeftBbox,
  type PdfPageView,
} from '@main/parsers/pdf/pdf-coords';

// Letter portrait: 612 × 792 pt.
const LETTER: PdfPageView = { view: [0, 0, 612, 792], rotation: 0 };

function makeItem(x: number, y: number, w: number, h: number) {
  // pdfjs transform: [scaleX, skewY, skewX, scaleY, e=x, f=y]
  return { transform: [1, 0, 0, 1, x, y], width: w, height: h };
}

describe('pdf-coords', () => {
  it('pageDimensions returns width × height unchanged for rotation=0', () => {
    expect(pageDimensions(LETTER)).toEqual({ width: 612, height: 792 });
  });

  it('pageDimensions swaps for rotation=90 / 270', () => {
    expect(pageDimensions({ ...LETTER, rotation: 90 })).toEqual({ width: 792, height: 612 });
    expect(pageDimensions({ ...LETTER, rotation: 270 })).toEqual({ width: 792, height: 612 });
  });

  it('translates bottom-left origin to top-left origin (rotation 0)', () => {
    // A text run at y=100 (60 units above bottom origin) with height 12.
    // In top-left coords, its top should be 792 - (100 + 12) = 680.
    const bbox = textItemToTopLeftBbox(makeItem(50, 100, 200, 12), LETTER);
    expect(bbox).toEqual({ x: 50, y: 680, w: 200, h: 12 });
  });

  it('preserves width/height for rotation 0 and 180', () => {
    const item = makeItem(50, 100, 200, 12);
    const r0 = textItemToTopLeftBbox(item, LETTER);
    const r180 = textItemToTopLeftBbox(item, { ...LETTER, rotation: 180 });
    expect(r0.w).toBe(200);
    expect(r0.h).toBe(12);
    expect(r180.w).toBe(200);
    expect(r180.h).toBe(12);
  });

  it('swaps width/height for rotation 90 and 270', () => {
    const item = makeItem(50, 100, 200, 12);
    const r90 = textItemToTopLeftBbox(item, { ...LETTER, rotation: 90 });
    expect(r90.w).toBe(12);
    expect(r90.h).toBe(200);
    const r270 = textItemToTopLeftBbox(item, { ...LETTER, rotation: 270 });
    expect(r270.w).toBe(12);
    expect(r270.h).toBe(200);
  });

  it('rotation 180 mirrors both axes', () => {
    // For rotation 180, top-left x = pageW - (rawX + width). With rawX=50, w=200:
    //   x = 612 - (50 + 200) = 362
    // And y simply becomes rawY (no flip). With rawY=100, h=12:
    //   y = 100
    const bbox = textItemToTopLeftBbox(makeItem(50, 100, 200, 12), {
      ...LETTER,
      rotation: 180,
    });
    expect(bbox).toEqual({ x: 362, y: 100, w: 200, h: 12 });
  });

  it('handles non-zero page origin (MediaBox not anchored at 0,0)', () => {
    const offsetPage: PdfPageView = { view: [10, 20, 612 + 10, 792 + 20], rotation: 0 };
    // Translate (60, 120) is relative to the page corner (10, 20):
    //   blX = 60 - 10 = 50; blY = 120 - 20 = 100
    //   y_topleft = 792 - (100 + 12) = 680
    const bbox = textItemToTopLeftBbox(makeItem(60, 120, 200, 12), offsetPage);
    expect(bbox).toEqual({ x: 50, y: 680, w: 200, h: 12 });
  });
});
