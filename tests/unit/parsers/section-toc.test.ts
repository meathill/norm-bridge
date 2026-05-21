import { describe, expect, it } from 'vitest';
import { parseSectionTocLines } from '@main/parsers/pdf/section-toc';

describe('parseSectionTocLines', () => {
  it('parses CSI "SECTION dd dd dd<page>" rows with flush page digits', () => {
    const lines = [
      'TABLE OF CONTENTS',
      'SECTION 01 11 006',
      'SECTION 01 11 0129',
      'SECTION 01 11 0592',
      'SECTION 01 31 03117',
      'SECTION 01 74 19705',
      'VOLUME 05 - General Specifications',
    ];
    const sections = parseSectionTocLines(lines, 957);
    const map = Object.fromEntries(sections.map((s) => [s.clauseNoGuess, s.pageStart]));
    expect(map['01 11 00']).toBe(6);
    expect(map['01 11 01']).toBe(29);
    expect(map['01 11 05']).toBe(92);
    expect(map['01 31 03']).toBe(117);
    expect(map['01 74 19']).toBe(705);
  });

  it('computes contiguous page ranges from sorted starts', () => {
    const sections = parseSectionTocLines(
      ['SECTION 01 11 006', 'SECTION 01 11 0129', 'SECTION 01 11 0592'],
      957,
    );
    expect(sections).toHaveLength(3);
    expect(sections[0]).toMatchObject({ pageStart: 6, pageEnd: 28 });
    expect(sections[1]).toMatchObject({ pageStart: 29, pageEnd: 91 });
    expect(sections[2]).toMatchObject({ pageStart: 92, pageEnd: 957 });
  });

  it('dedups repeated section numbers, keeping the first page seen', () => {
    const sections = parseSectionTocLines(
      ['SECTION 01 11 006', 'SECTION 01 11 006', 'SECTION 01 11 0129'],
      957,
    );
    expect(sections.filter((s) => s.clauseNoGuess === '01 11 00')).toHaveLength(1);
  });

  it('ignores page numbers beyond the document length', () => {
    const sections = parseSectionTocLines(['SECTION 01 11 009999'], 957);
    // 9999 > 957 → rejected
    expect(sections).toHaveLength(0);
  });

  it('returns empty for lines without TOC rows', () => {
    expect(parseSectionTocLines(['just some prose', 'no sections here'], 100)).toEqual([]);
  });

  it('sets a stable id and SECTION-prefixed title', () => {
    const [s] = parseSectionTocLines(['SECTION 01 74 19705'], 957);
    expect(s?.id).toMatch(/^cls_/);
    expect(s?.title).toBe('SECTION 01 74 19');
    expect(s?.looksLikeContent).toBe(true);
  });
});
