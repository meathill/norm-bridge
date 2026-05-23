import { z } from 'zod';

/**
 * What each skill is expected to return. These are LENIENT on purpose: the LLM
 * output is parsed by us (not the provider's strict json_schema enforcement),
 * so we accept loose/partial shapes and normalize defaults in SchemaCompileService.
 *
 * Every optional field uses `.nullish()` (not `.optional()`): models routinely
 * emit `"field": null` for "absent" rather than omitting the key, and rejecting
 * null would throw away an otherwise-valid window. Downstream code already treats
 * null and undefined identically (via `??` and conditional spreads).
 *
 * Citation anchors only require a verbatim `quote`; `page` and `textBlockIds` are
 * optional. The compiler resolves block ids by matching the quote against the
 * page's text blocks, because models can't reliably echo back our internal ids.
 */

const citationAnchorSchema = z.object({
  page: z.coerce.number().int().positive().nullish(),
  /** Optional: internal text-block ids, if the model echoed them. */
  textBlockIds: z.array(z.string()).nullish(),
  /** Verbatim quote, copied from the source text. */
  quote: z.string().min(1),
});

const clauseCandidateSchema = z.object({
  /** Local id within the output, used to wire up parent-child links. */
  localId: z.string().min(1),
  parentLocalId: z.string().nullish(),
  clauseNo: z.string().nullish(),
  title: z.string().nullish(),
  pageStart: z.coerce.number().int().positive().nullish(),
  pageEnd: z.coerce.number().int().positive().nullish(),
  rawText: z.string().nullish(),
  confidence: z.coerce.number().min(0).max(1).nullish(),
  citationAnchors: z.array(citationAnchorSchema).nullish(),
});

const requirementCandidateSchema = z.object({
  localClauseId: z.string().nullish(),
  subject: z.string().nullish(),
  appliesTo: z.string().nullish(),
  conditionText: z.string().nullish(),
  requirementText: z.string().min(1),
  parameterName: z.string().nullish(),
  operator: z.string().nullish(),
  valueText: z.string().nullish(),
  unit: z.string().nullish(),
  testMethod: z.string().nullish(),
  evidenceRequired: z.string().nullish(),
  severity: z.enum(['mandatory', 'recommended', 'informational']).nullish(),
  confidence: z.coerce.number().min(0).max(1).nullish(),
  citationAnchors: z.array(citationAnchorSchema).nullish(),
});

const referenceCandidateSchema = z.object({
  fromLocalClauseId: z.string().nullish(),
  referencedStandardCode: z.string().min(1),
  referencedClause: z.string().nullish(),
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
    .nullish(),
  confidence: z.coerce.number().min(0).max(1).nullish(),
  citationAnchors: z.array(citationAnchorSchema).nullish(),
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

/**
 * Single-call output: clauses + requirements + references together. We send the
 * section text once and ask for everything in one response — far cheaper and
 * faster than three sequential calls (which each re-send the full text), which
 * matters a lot for slow third-party endpoints.
 */
export const combinedCompileOutputSchema = z.object({
  clauses: z.array(clauseCandidateSchema).default([]),
  requirements: z.array(requirementCandidateSchema).default([]),
  references: z.array(referenceCandidateSchema).default([]),
});
export type CombinedCompileOutput = z.infer<typeof combinedCompileOutputSchema>;

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
