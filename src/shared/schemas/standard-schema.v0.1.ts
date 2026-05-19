import { z } from 'zod';
import { STANDARD_SCHEMA_VERSION } from '../domain/standard-schema';

const reviewStatusSchema = z.enum(['unreviewed', 'verified', 'rejected', 'needs_review']);

const citationRecordSchema = z.object({
  id: z.string().min(1),
  sourceId: z.string().min(1),
  sourceHash: z.string().min(1),
  page: z.number().int().positive().optional(),
  sheetName: z.string().optional(),
  cellRef: z.string().optional(),
  paragraphIndex: z.number().int().nonnegative().optional(),
  tableIndex: z.number().int().nonnegative().optional(),
  clauseNo: z.string().optional(),
  textStart: z.number().int().nonnegative().optional(),
  textEnd: z.number().int().nonnegative().optional(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  quote: z.string().min(1),
});

const clauseRecordSchema = z.object({
  id: z.string().min(1),
  standardId: z.string().min(1),
  parentClauseId: z.string().nullable(),
  clauseNo: z.string().optional(),
  title: z.string().optional(),
  pageStart: z.number().int().positive().optional(),
  pageEnd: z.number().int().positive().optional(),
  rawText: z.string().optional(),
  reviewStatus: reviewStatusSchema,
});

const requirementRecordSchema = z.object({
  id: z.string().min(1),
  standardId: z.string().min(1),
  clauseId: z.string().optional(),
  subject: z.string().optional(),
  appliesTo: z.string().optional(),
  conditionText: z.string().optional(),
  requirementText: z.string().min(1),
  parameterName: z.string().optional(),
  operator: z.string().optional(),
  valueText: z.string().optional(),
  unit: z.string().optional(),
  testMethod: z.string().optional(),
  evidenceRequired: z.string().optional(),
  severity: z.enum(['mandatory', 'recommended', 'informational']).optional(),
  confidence: z.number().min(0).max(1),
  citationIds: z.array(z.string()),
  reviewStatus: reviewStatusSchema,
});

const standardReferenceRecordSchema = z.object({
  id: z.string().min(1),
  fromStandardId: z.string().min(1),
  fromClauseId: z.string().optional(),
  referencedStandardCode: z.string().min(1),
  referencedClause: z.string().optional(),
  relationType: z
    .enum([
      'normative',
      'informative',
      'equivalent',
      'adopted',
      'replaces',
      'replaced_by',
      'unknown',
    ])
    .optional(),
  citationIds: z.array(z.string()),
  reviewStatus: reviewStatusSchema,
});

const standardRecordSchema = z.object({
  id: z.string().min(1),
  sourceId: z.string().min(1),
  title: z.string().optional(),
  countryOrRegion: z.string().optional(),
  version: z.string().optional(),
  publicationDate: z.string().optional(),
  scope: z.string().optional(),
  status: z.enum(['draft', 'compiled', 'verified']),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const standardSchemaArtifactSchema = z.object({
  schemaVersion: z.literal(STANDARD_SCHEMA_VERSION),
  standard: standardRecordSchema,
  clauses: z.array(clauseRecordSchema),
  requirements: z.array(requirementRecordSchema),
  citations: z.array(citationRecordSchema),
  references: z.array(standardReferenceRecordSchema),
  compiledAt: z.string(),
});

export {
  citationRecordSchema,
  clauseRecordSchema,
  requirementRecordSchema,
  standardRecordSchema,
  standardReferenceRecordSchema,
};
