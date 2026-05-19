import { z } from 'zod';

/**
 * What each skill is expected to return. Citations are referenced by the
 * text-block IDs the skill grounded its answer in; the SchemaCompileService
 * turns those anchors into Citation rows after validation.
 */

const citationAnchorSchema = z.object({
  page: z.number().int().positive(),
  /** Indices into the per-page reading-order list, or text-block IDs. */
  textBlockIds: z.array(z.string()).min(1),
  /** Verbatim quote, copied from the source text blocks. */
  quote: z.string().min(1),
});

const clauseCandidateSchema = z.object({
  /** Local id within the output, used to wire up parent-child links. */
  localId: z.string().min(1),
  parentLocalId: z.string().nullable(),
  clauseNo: z.string().optional(),
  title: z.string().optional(),
  pageStart: z.number().int().positive(),
  pageEnd: z.number().int().positive(),
  rawText: z.string().optional(),
  confidence: z.number().min(0).max(1),
  citationAnchors: z.array(citationAnchorSchema).min(1),
});

const requirementCandidateSchema = z.object({
  localClauseId: z.string().min(1),
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
  citationAnchors: z.array(citationAnchorSchema).min(1),
});

const referenceCandidateSchema = z.object({
  fromLocalClauseId: z.string().optional(),
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
  confidence: z.number().min(0).max(1),
  citationAnchors: z.array(citationAnchorSchema).min(1),
});

export const clauseCompilerOutputSchema = z.object({
  clauses: z.array(clauseCandidateSchema),
});

export const requirementExtractorOutputSchema = z.object({
  requirements: z.array(requirementCandidateSchema),
});

export const referenceResolverOutputSchema = z.object({
  references: z.array(referenceCandidateSchema),
});

export {
  citationAnchorSchema,
  clauseCandidateSchema,
  referenceCandidateSchema,
  requirementCandidateSchema,
};

export type CitationAnchor = z.infer<typeof citationAnchorSchema>;
export type ClauseCandidate = z.infer<typeof clauseCandidateSchema>;
export type RequirementCandidate = z.infer<typeof requirementCandidateSchema>;
export type ReferenceCandidate = z.infer<typeof referenceCandidateSchema>;
export type ClauseCompilerOutput = z.infer<typeof clauseCompilerOutputSchema>;
export type RequirementExtractorOutput = z.infer<typeof requirementExtractorOutputSchema>;
export type ReferenceResolverOutput = z.infer<typeof referenceResolverOutputSchema>;
