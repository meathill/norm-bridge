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
