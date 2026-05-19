import { describe, expect, it } from 'vitest';
import type { PdfPageInfo, PdfTextBlock } from '@shared/domain/pdf-extract';
import { MockAgentRunner } from '@agents/mock-agent-runner';
import {
  clauseCompilerOutputSchema,
  referenceResolverOutputSchema,
  requirementExtractorOutputSchema,
} from '@shared/schemas/agent-outputs';

function block(id: string, page: number, y: number, text: string): PdfTextBlock {
  return {
    id,
    page,
    text,
    bbox: { x: 0, y, w: 200, h: 12 },
    readingOrder: Number(id.replace(/[^0-9]/g, '')) || 0,
  };
}

function pages(count: number): PdfPageInfo[] {
  return Array.from({ length: count }).map((_, i) => ({
    page: i + 1,
    width: 612,
    height: 792,
    rotation: 0,
    textBlockCount: 1,
  }));
}

describe('MockAgentRunner', () => {
  it('detects numbered clause headings and groups children correctly', async () => {
    const runner = new MockAgentRunner();
    const textBlocks: PdfTextBlock[] = [
      block('b1', 1, 100, '1 Scope'),
      block('b2', 1, 120, 'This standard applies to low-voltage circuit breakers.'),
      block('b3', 1, 140, '1.1 General'),
      block('b4', 1, 160, 'The breakers shall be tested per Clause 9.'),
      block('b5', 2, 100, '2 Normative references'),
      block('b6', 2, 120, 'The following documents are referred to in the text: IEC 60898-1.'),
    ];

    const out = await runner.compile({
      sourceId: 'src_demo',
      sourceOriginalName: 'demo.pdf',
      pages: pages(2),
      textBlocks,
    });

    expect(() => clauseCompilerOutputSchema.parse(out.clauses)).not.toThrow();
    expect(() => requirementExtractorOutputSchema.parse(out.requirements)).not.toThrow();
    expect(() => referenceResolverOutputSchema.parse(out.references)).not.toThrow();

    const clauseNos = out.clauses.clauses.map((c) => c.clauseNo);
    expect(clauseNos).toEqual(expect.arrayContaining(['1', '1.1', '2']));

    const c11 = out.clauses.clauses.find((c) => c.clauseNo === '1.1');
    const c1 = out.clauses.clauses.find((c) => c.clauseNo === '1');
    expect(c11?.parentLocalId).toBe(c1?.localId);
  });

  it('attaches "shall" sentences as requirements to the owning clause', async () => {
    const runner = new MockAgentRunner();
    const textBlocks: PdfTextBlock[] = [
      block('b1', 1, 100, '4.1 Insulation'),
      block('b2', 1, 120, 'The insulation shall withstand 1500 V for 1 minute.'),
      block('b3', 1, 140, 'The product shall not be used outside its temperature range.'),
    ];

    const out = await runner.compile({
      sourceId: 'src_demo',
      sourceOriginalName: 'demo.pdf',
      pages: pages(1),
      textBlocks,
    });

    expect(out.requirements.requirements).toHaveLength(2);
    for (const r of out.requirements.requirements) {
      expect(r.citationAnchors[0]?.textBlockIds.length).toBeGreaterThan(0);
      expect(r.citationAnchors[0]?.quote).toMatch(/shall/i);
    }
  });

  it('detects referenced standards by code pattern', async () => {
    const runner = new MockAgentRunner();
    const textBlocks: PdfTextBlock[] = [
      block('b1', 1, 100, '2 Normative references'),
      block(
        'b2',
        1,
        120,
        'IEC 60898-1:2015 Circuit-breakers; GB/T 14048.2-2008 applies to selection.',
      ),
    ];
    const out = await runner.compile({
      sourceId: 'src_demo',
      sourceOriginalName: 'demo.pdf',
      pages: pages(1),
      textBlocks,
    });
    const codes = out.references.references.map((r) => r.referencedStandardCode);
    expect(codes.some((c) => c.startsWith('IEC 60898-1'))).toBe(true);
    expect(codes.some((c) => c.startsWith('GB/T 14048'))).toBe(true);
  });
});
