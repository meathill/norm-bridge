import { z } from 'zod';

/**
 * What each skill is expected to return. These are LENIENT on purpose: the LLM
 * output is parsed by us (not the provider's strict json_schema enforcement),
 * so we accept loose/partial shapes and normalize defaults in SchemaCompileService.
 *
 * Citation anchors only require a verbatim `quote`; `page` and `textBlockIds` are
 * optional. The compiler resolves block ids by matching the quote against the
 * page's text blocks, because models can't reliably echo back our internal ids.
 */

const citationAnchorSchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  /** Optional: internal text-block ids, if the model echoed them. */
  textBlockIds: z.array(z.string()).optional(),
  /** Verbatim quote, copied from the source text. */
  quote: z.string().min(1),
});

const clauseCandidateSchema = z.object({
  /** Local id within the output, used to wire up parent-child links. */
  localId: z.string().min(1),
  parentLocalId: z.string().nullish(),
  clauseNo: z.string().optional(),
  title: z.string().optional(),
  pageStart: z.coerce.number().int().positive().optional(),
  pageEnd: z.coerce.number().int().positive().optional(),
  rawText: z.string().optional(),
  confidence: z.coerce.number().min(0).max(1).optional(),
  citationAnchors: z.array(citationAnchorSchema).optional(),
});

const requirementCandidateSchema = z.object({
  localClauseId: z.string().optional(),
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
  confidence: z.coerce.number().min(0).max(1).optional(),
  citationAnchors: z.array(citationAnchorSchema).optional(),
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
  confidence: z.coerce.number().min(0).max(1).optional(),
  citationAnchors: z.array(citationAnchorSchema).optional(),
});

export const clauseCompilerOutputSchema = z.object({
  clauses: z.array(clauseCandidateSchema).default([]),
});

export const requirementExtractorOutputSchema = z.object({
  requirements: z.array(requirementCandidateSchema).default([]),
});

export const referenceResolverOutputSchema = z.object({
  references: z.array(referenceCandidateSchema).default([]),
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
