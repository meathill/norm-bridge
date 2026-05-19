/**
 * Materialized schema for a single standard. Mirrors TECH_SPEC §11.1 tables
 * verbatim so the JSON artifact and the SQLite rows stay one-to-one.
 */

export const STANDARD_SCHEMA_VERSION = '0.1' as const;

export type ReviewStatus = 'unreviewed' | 'verified' | 'rejected' | 'needs_review';

export type StandardRecord = {
  id: string;
  sourceId: string;
  title?: string;
  countryOrRegion?: string;
  version?: string;
  publicationDate?: string;
  scope?: string;
  status: 'draft' | 'compiled' | 'verified';
  createdAt: string;
  updatedAt: string;
};

export type ClauseRecord = {
  id: string;
  standardId: string;
  parentClauseId: string | null;
  clauseNo?: string;
  title?: string;
  pageStart?: number;
  pageEnd?: number;
  rawText?: string;
  reviewStatus: ReviewStatus;
};

export type CitationRecord = {
  id: string;
  sourceId: string;
  sourceHash: string;
  page?: number;
  sheetName?: string;
  cellRef?: string;
  paragraphIndex?: number;
  tableIndex?: number;
  clauseNo?: string;
  textStart?: number;
  textEnd?: number;
  bbox?: [number, number, number, number];
  quote: string;
};

export type RequirementRecord = {
  id: string;
  standardId: string;
  clauseId?: string;
  subject?: string;
  appliesTo?: string;
  conditionText?: string;
  requirementText: string;
  parameterName?: string;
  operator?: string;
  valueText?: string;
  unit?: string;
  testMethod?: string;
  evidenceRequired?: string;
  severity?: 'mandatory' | 'recommended' | 'informational';
  confidence: number;
  citationIds: string[];
  reviewStatus: ReviewStatus;
};

export type StandardReferenceRecord = {
  id: string;
  fromStandardId: string;
  fromClauseId?: string;
  referencedStandardCode: string;
  referencedClause?: string;
  relationType?:
    | 'normative'
    | 'informative'
    | 'equivalent'
    | 'adopted'
    | 'replaces'
    | 'replaced_by'
    | 'unknown';
  citationIds: string[];
  reviewStatus: ReviewStatus;
};

/**
 * Top-level artifact written to artifacts/standards/<sourceId>/standard-schema.v0.1.json.
 * Reflects the compiled state of one standard PDF.
 */
export type StandardSchemaArtifact = {
  schemaVersion: typeof STANDARD_SCHEMA_VERSION;
  standard: StandardRecord;
  clauses: ClauseRecord[];
  requirements: RequirementRecord[];
  citations: CitationRecord[];
  references: StandardReferenceRecord[];
  compiledAt: string;
};
