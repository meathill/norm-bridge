/**
 * Search domain. A query goes through three steps:
 *   1. expand — turn the free-text query into normalized tokens + optional
 *      structured filters (product category, parameters).
 *   2. retrieve — SQLite keyword lookup across requirements / clauses / citations.
 *   3. summarize — optional natural-language wrap-up from the agent.
 */

export type SearchExpansion = {
  tokens: string[];
  productCategory?: string;
  parameters?: Record<string, string>;
};

/** One concrete citation address: where in the source this text comes from. */
export type SearchCitation = {
  citationId: string;
  page?: number;
  /** Verbatim quote from the source (the "引用原文"). */
  quote: string;
};

/** The standard/section a hit belongs to (the "技术规范标准"). */
export type SearchStandardRef = {
  standardId: string;
  standardTitle?: string;
  /** Top-level section the requirement lives under, e.g. "01 74 19 Waste Management". */
  sectionNo?: string;
  sectionTitle?: string;
};

export type SearchResultCard = {
  cardId: string;
  sourceId: string;
  standardId: string;
  requirementId?: string;
  clauseId?: string;
  clauseNo?: string;
  clauseTitle?: string;
  requirementText: string;
  page?: number;
  citationIds: string[];
  /** Citation addresses (page + verbatim quote) backing this hit. */
  citations: SearchCitation[];
  /** The standard / section this requirement belongs to. */
  standard: SearchStandardRef;
  /** External standards (ISO/IEC/EN…) the owning section references, if any. */
  referencedStandards: string[];
  /** Match score from the SQLite retriever (higher = better). */
  score: number;
};

export type SearchQueryInput = {
  text: string;
  /** Optional: scope the search to a single imported standard. */
  sourceId?: string;
  /** Top-N result cap; defaults to 8 in the service. */
  limit?: number;
};

export type SearchQueryResult = {
  query: string;
  expanded?: SearchExpansion;
  cards: SearchResultCard[];
  summary?: string;
  /** Identifier of the agent runner used for expansion (e.g. "mock" or "openai-agents"). */
  expanderId: string;
};
