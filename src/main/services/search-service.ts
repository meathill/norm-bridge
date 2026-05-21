import { newId } from '@shared/ids';
import type {
  SearchCitation,
  SearchExpansion,
  SearchQueryInput,
  SearchQueryResult,
  SearchResultCard,
  SearchStandardRef,
} from '@shared/domain/search';
import type { SearchRunner } from '@agents/search-runner';
import type { ProjectSession } from './project-session';
import type { SqliteService } from './sqlite-service';

const DEFAULT_LIMIT = 8;

type RequirementRow = {
  id: string;
  standard_id: string;
  source_id: string;
  standard_title: string | null;
  requirement_text: string;
  clause_id: string | null;
  clause_no: string | null;
  clause_title: string | null;
  clause_raw_text: string | null;
  citation_id: string | null;
  page: number | null;
};

type CitationsForRequirementRow = {
  requirement_id: string;
  citation_id: string;
  page: number | null;
  quote: string;
};

type ClauseRow = {
  id: string;
  parent_clause_id: string | null;
  clause_no: string | null;
  title: string | null;
};

export class SearchService {
  constructor(
    private readonly session: ProjectSession,
    private readonly sqlite: SqliteService,
    private readonly runner: SearchRunner,
  ) {}

  async query(input: SearchQueryInput): Promise<SearchQueryResult> {
    const project = this.session.getCurrent();
    if (!project) throw new Error('No project is open.');

    const limit = Math.max(1, Math.min(50, input.limit ?? DEFAULT_LIMIT));

    const knownCodes = this.distinctStandardCodes();
    const expansionInput: { query: string; knownStandardCodes?: string[] } = {
      query: input.text,
    };
    if (knownCodes.length > 0) expansionInput.knownStandardCodes = knownCodes;
    let expansion: SearchExpansion = await this.runner.expand(expansionInput);
    if (expansion.tokens.length === 0) {
      // Fall back to a plain whitespace split so we never end up with no tokens.
      expansion = { tokens: input.text.toLowerCase().split(/\s+/).filter(Boolean) };
    }

    const cards = this.runKeywordSearch(expansion.tokens, input.sourceId, limit);

    let summary: string | null = null;
    try {
      summary = await this.runner.summarize({ query: input.text, cards });
    } catch {
      summary = null;
    }

    return {
      query: input.text,
      expanded: expansion,
      cards,
      ...(summary ? { summary } : {}),
      expanderId: this.runner.id,
    };
  }

  private runKeywordSearch(
    tokens: string[],
    sourceId: string | undefined,
    limit: number,
  ): SearchResultCard[] {
    if (tokens.length === 0) return [];

    // Pull all requirements (optionally filtered by source) with their primary clause info
    // and one representative citation (first one by id). v0.1 dataset is small enough for
    // in-memory scoring; we can move to FTS5 later.
    const rows = this.fetchRequirementRows(sourceId);
    const citations = this.fetchCitationsForRequirements(rows.map((r) => r.id));

    const lowered = tokens.map((t) => t.toLowerCase());
    const scored = rows
      .map((r) => ({
        row: r,
        score: scoreRow(r, lowered),
      }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    const cards: SearchResultCard[] = scored.map(({ row, score }) => {
      const citsForReq = citations.get(row.id) ?? [];
      const firstCit = citsForReq[0];
      const citationDetails: SearchCitation[] = citsForReq.map((c) => ({
        citationId: c.citation_id,
        ...(c.page !== null ? { page: c.page } : {}),
        quote: c.quote,
      }));

      const section = row.clause_id ? this.resolveSection(row.clause_id) : null;
      const standard: SearchStandardRef = {
        standardId: row.standard_id,
        ...(row.standard_title ? { standardTitle: row.standard_title } : {}),
        ...(section?.clause_no ? { sectionNo: section.clause_no } : {}),
        ...(section?.title ? { sectionTitle: section.title } : {}),
      };
      const referencedStandards = section
        ? this.referencedStandardsForClause(section.id, row.standard_id)
        : [];

      const card: SearchResultCard = {
        cardId: newId('matchResult'),
        sourceId: row.source_id,
        standardId: row.standard_id,
        requirementId: row.id,
        requirementText: row.requirement_text,
        citationIds: citsForReq.map((c) => c.citation_id),
        citations: citationDetails,
        standard,
        referencedStandards,
        score,
      };
      if (row.clause_id) card.clauseId = row.clause_id;
      if (row.clause_no) card.clauseNo = row.clause_no;
      if (row.clause_title) card.clauseTitle = row.clause_title;
      const page = firstCit?.page ?? row.page;
      if (page !== null && page !== undefined) card.page = page;
      return card;
    });
    return cards;
  }

  /** Walk a clause up to its top-level ancestor (the section / standard the hit belongs to). */
  private resolveSection(clauseId: string): ClauseRow | null {
    const stmt = this.sqlite.prepare(
      'SELECT id, parent_clause_id, clause_no, title FROM clauses WHERE id = ?',
    );
    let current = stmt.get(clauseId) as ClauseRow | undefined;
    if (!current) return null;
    const seen = new Set<string>();
    while (current.parent_clause_id && !seen.has(current.id)) {
      seen.add(current.id);
      const parent = stmt.get(current.parent_clause_id) as ClauseRow | undefined;
      if (!parent) break;
      current = parent;
    }
    return current;
  }

  /** External standards referenced from a section's clause subtree. */
  private referencedStandardsForClause(_sectionClauseId: string, standardId: string): string[] {
    const rows = this.sqlite
      .prepare(
        `SELECT DISTINCT referenced_standard_code
         FROM standard_references
         WHERE from_standard_id = ?
         LIMIT 20`,
      )
      .all(standardId) as Array<{ referenced_standard_code: string }>;
    return rows.map((r) => r.referenced_standard_code);
  }

  private fetchRequirementRows(sourceId: string | undefined): RequirementRow[] {
    const where = sourceId ? 'WHERE s.source_id = ?' : '';
    const stmt = this.sqlite.prepare(
      `SELECT r.id, r.standard_id, s.source_id, s.title as standard_title, r.requirement_text,
              r.clause_id, c.clause_no, c.title as clause_title, c.raw_text as clause_raw_text,
              NULL as citation_id, NULL as page
       FROM requirements r
       JOIN standards s ON r.standard_id = s.id
       LEFT JOIN clauses c ON r.clause_id = c.id
       ${where}`,
    );
    const rows = (sourceId ? stmt.all(sourceId) : stmt.all()) as RequirementRow[];
    return rows;
  }

  private fetchCitationsForRequirements(
    requirementIds: string[],
  ): Map<string, CitationsForRequirementRow[]> {
    const map = new Map<string, CitationsForRequirementRow[]>();
    if (requirementIds.length === 0) return map;
    // SQLite parameter limit safety: chunk by 500 just in case.
    const chunkSize = 500;
    for (let i = 0; i < requirementIds.length; i += chunkSize) {
      const chunk = requirementIds.slice(i, i + chunkSize);
      const placeholders = chunk.map(() => '?').join(',');
      const stmt = this.sqlite.prepare(
        `SELECT rc.requirement_id, rc.citation_id, cit.page, cit.quote
         FROM requirement_citations rc
         JOIN citations cit ON rc.citation_id = cit.id
         WHERE rc.requirement_id IN (${placeholders})
         ORDER BY rc.requirement_id, cit.page`,
      );
      const rows = stmt.all(...chunk) as CitationsForRequirementRow[];
      for (const row of rows) {
        const list = map.get(row.requirement_id) ?? [];
        list.push(row);
        map.set(row.requirement_id, list);
      }
    }
    return map;
  }

  private distinctStandardCodes(): string[] {
    const rows = this.sqlite
      .prepare('SELECT DISTINCT referenced_standard_code FROM standard_references LIMIT 200')
      .all() as Array<{ referenced_standard_code: string }>;
    return rows.map((r) => r.referenced_standard_code);
  }
}

export function scoreRow(row: RequirementRow, lowered: string[]): number {
  const hay =
    `${row.requirement_text}\n${row.clause_title ?? ''}\n${row.clause_no ?? ''}\n${row.clause_raw_text ?? ''}`.toLowerCase();
  let score = 0;
  for (const t of lowered) {
    if (t && hay.includes(t)) score += 1;
  }
  return score;
}
