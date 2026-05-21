import { newId } from '@shared/ids';
import type { SectionEntry } from '@shared/domain/section';

/**
 * Printed-TOC line shape seen in CSI MasterFormat specs:
 *   "SECTION 01 74 19705"  →  section "01 74 19", page 705
 * The dotted leader between the number and the page is not in the text layer,
 * so the page digits sit flush against the section number. Section numbers are
 * always three 2-digit groups; everything after is the page.
 */
export const SECTION_TOC_RE = /SECTION\s+(\d{2})\s*(\d{2})\s*(\d{2})(\d{1,4})/g;

/** Section numbers we treat as administrative boilerplate rather than body content. */
const BOILERPLATE_CLAUSE_RE = /\b(00 01|00 91)\b/; // CSI: procurement/contracting front matter

/**
 * Parse reconstructed TOC lines into a deduped, page-sorted section list with
 * computed page ranges. Pure function so it can be unit-tested without a PDF.
 */
export function parseSectionTocLines(lines: string[], numPages: number): SectionEntry[] {
  const byClause = new Map<string, number>();
  for (const line of lines) {
    SECTION_TOC_RE.lastIndex = 0;
    let m: RegExpExecArray | null = SECTION_TOC_RE.exec(line);
    while (m) {
      const clauseNo = `${m[1]} ${m[2]} ${m[3]}`;
      const pageNo = Number.parseInt(m[4] ?? '', 10);
      if (Number.isFinite(pageNo) && pageNo >= 1 && pageNo <= numPages) {
        if (!byClause.has(clauseNo)) byClause.set(clauseNo, pageNo);
      }
      m = SECTION_TOC_RE.exec(line);
    }
  }

  const sorted = [...byClause.entries()]
    .map(([clauseNo, pageStart]) => ({ clauseNo, pageStart }))
    .sort((a, b) => a.pageStart - b.pageStart);

  return sorted.map((cur, i) => {
    const next = sorted[i + 1];
    const pageEnd = next ? Math.max(cur.pageStart, next.pageStart - 1) : numPages;
    return {
      id: newId('clause'),
      title: `SECTION ${cur.clauseNo}`,
      clauseNoGuess: cur.clauseNo,
      pageStart: cur.pageStart,
      pageEnd,
      level: 0,
      looksLikeContent: !BOILERPLATE_CLAUSE_RE.test(cur.clauseNo),
    };
  });
}
