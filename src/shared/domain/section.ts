/**
 * A section of a standard, derived from the PDF's embedded outline (bookmarks)
 * or, failing that, the printed table of contents. Sections give us reliable
 * page ranges so the compiler can process the document chapter-by-chapter
 * instead of truncating a giant single prompt.
 */
export type SectionEntry = {
  id: string;
  title: string;
  /** 1-based inclusive page where the section starts. */
  pageStart: number;
  /** 1-based inclusive page where the section ends (next section start - 1, or last page). */
  pageEnd: number;
  /** Outline depth (0 = top level). */
  level: number;
  /** Best-effort clause/section number parsed from the title, e.g. "01 74 19" or "4.2". */
  clauseNoGuess?: string;
  /** Heuristic: does this look like body content (vs. boilerplate like foreword/TOC)? */
  looksLikeContent: boolean;
};

export type SectionMap = {
  /** How the map was obtained. */
  source: 'outline' | 'printed_toc' | 'none';
  entries: SectionEntry[];
};
