import { Agent, run } from '@openai/agents';
import {
  clauseCompilerOutputSchema,
  referenceResolverOutputSchema,
  requirementExtractorOutputSchema,
  type ClauseCompilerOutput,
  type ReferenceResolverOutput,
  type RequirementExtractorOutput,
} from '@shared/schemas/agent-outputs';
import type { PdfTextBlock } from '@shared/domain/pdf-extract';
import type {
  AgentCompileCallbacks,
  AgentCompileContext,
  AgentCompileResult,
  AgentRunner,
} from './agent-runner';
import { configureOpenAiRuntime } from './runtime-config';

const CLAUSE_INSTRUCTIONS = `You compile a technical-standard PDF into a clause tree.
The user message contains text blocks tagged by page and block id. Detect headings of the form
"N", "N.N", "N.N.N" with a short title, and group surrounding paragraphs as the clause body.
Set parentLocalId by trimming the trailing segment of clauseNo. Use the block ids you grounded
each clause in as citationAnchors.textBlockIds. NEVER invent a quote that does not appear verbatim
in the input. Confidence is your subjective certainty (0..1).`;

const REQUIREMENT_INSTRUCTIONS = `You extract mandatory requirements from a technical standard.
You receive (a) the clause tree produced earlier and (b) the original text blocks. For each
sentence that uses a modal verb (shall, shall not, must, must not), emit one requirement.
Cite the block ids you read it from. Map it to the most specific clause that owns the page.
Set localClauseId to the clauseLocalId from the clause tree. severity is "mandatory" for shall/must
sentences, "recommended" for "should", "informational" otherwise. NEVER invent quotes.`;

const REFERENCE_INSTRUCTIONS = `You identify other standards referenced from this PDF.
Look for codes like "IEC 60898-1:2015", "GB/T 14048", "ISO 80000-1", and so on. For each, output
its standard code, the citing clause if obvious, an optional referenced clause, and a relationType:
- normative: appears in a Normative References clause
- informative: appears in a Bibliography
- equivalent / adopted / replaces / replaced_by: only if the source text says so explicitly
- unknown: when the relationship is not stated
Cite the block ids you read each from. NEVER invent quotes.`;

const DEFAULT_MAX_PROMPT_BLOCKS = 8000;

export type OpenAiRunnerOptions = {
  /** Override model for this runner only; otherwise reads NORMBRIDGE_COMPILE_MODEL / NORMBRIDGE_AGENT_MODEL. */
  model?: string;
  maxBlocksPerPrompt?: number;
};

export class OpenAiAgentRunner implements AgentRunner {
  readonly id = 'openai-agents';
  private readonly explicitModel?: string;
  private readonly maxBlocks: number;

  constructor(opts?: OpenAiRunnerOptions) {
    if (opts?.model) this.explicitModel = opts.model;
    this.maxBlocks = opts?.maxBlocksPerPrompt ?? DEFAULT_MAX_PROMPT_BLOCKS;
  }

  async compile(
    ctx: AgentCompileContext,
    callbacks?: AgentCompileCallbacks,
  ): Promise<AgentCompileResult> {
    // Eager check: surface the missing-config error before we spend any time on the input.
    const cfg = configureOpenAiRuntime();
    const model = this.explicitModel ?? cfg.compileModel;

    const text = blocksToPromptText(ctx.textBlocks, this.maxBlocks);
    await callbacks?.onLog?.(
      'info',
      `openai-agent-runner: model=${model}, baseURL=${cfg.baseURL ?? '(default)'}`,
    );

    const clauseAgent = new Agent({
      name: 'ClauseCompiler',
      instructions: CLAUSE_INSTRUCTIONS,
      model,
      outputType: clauseCompilerOutputSchema,
    });
    await callbacks?.onProgress?.('clauses', 0);
    const clauseRun = await run(clauseAgent, [
      { role: 'user', content: `${standardHeader(ctx)}\n\n${text}` },
    ]);
    const clauses = ensureOutput<ClauseCompilerOutput>(clauseRun.finalOutput, 'clauses');
    await callbacks?.onProgress?.('clauses', 1);
    await callbacks?.onLog?.('info', `openai: ${clauses.clauses.length} clauses`);

    const requirementAgent = new Agent({
      name: 'RequirementExtractor',
      instructions: REQUIREMENT_INSTRUCTIONS,
      model,
      outputType: requirementExtractorOutputSchema,
    });
    await callbacks?.onProgress?.('requirements', 0);
    const requirementRun = await run(requirementAgent, [
      {
        role: 'user',
        content: `${standardHeader(ctx)}\n\nClause tree:\n${JSON.stringify(clauses.clauses, null, 2)}\n\nText blocks:\n${text}`,
      },
    ]);
    const requirements = ensureOutput<RequirementExtractorOutput>(
      requirementRun.finalOutput,
      'requirements',
    );
    await callbacks?.onProgress?.('requirements', 1);
    await callbacks?.onLog?.('info', `openai: ${requirements.requirements.length} requirements`);

    const referenceAgent = new Agent({
      name: 'ReferenceResolver',
      instructions: REFERENCE_INSTRUCTIONS,
      model,
      outputType: referenceResolverOutputSchema,
    });
    await callbacks?.onProgress?.('references', 0);
    const referenceRun = await run(referenceAgent, [
      { role: 'user', content: `${standardHeader(ctx)}\n\n${text}` },
    ]);
    const references = ensureOutput<ReferenceResolverOutput>(
      referenceRun.finalOutput,
      'references',
    );
    await callbacks?.onProgress?.('references', 1);
    await callbacks?.onLog?.('info', `openai: ${references.references.length} references`);

    return { clauses, requirements, references };
  }
}

function ensureOutput<T>(out: unknown, stage: string): T {
  if (out === undefined || out === null) {
    throw new Error(`Agent returned no output for stage ${stage}`);
  }
  return out as T;
}

function standardHeader(ctx: AgentCompileContext): string {
  return `Standard PDF: ${ctx.sourceOriginalName} (source id ${ctx.sourceId}, ${ctx.pages.length} pages).`;
}

function blocksToPromptText(blocks: PdfTextBlock[], cap: number): string {
  const grouped = new Map<number, PdfTextBlock[]>();
  for (const b of blocks.slice(0, cap)) {
    const list = grouped.get(b.page) ?? [];
    list.push(b);
    grouped.set(b.page, list);
  }
  const out: string[] = [];
  for (const [page, list] of [...grouped.entries()].sort((a, b) => a[0] - b[0])) {
    out.push(`<page ${page}>`);
    for (const b of list) {
      out.push(`  [${b.id}] ${b.text}`);
    }
  }
  if (blocks.length > cap) {
    out.push(`<truncated: ${blocks.length - cap} block(s) omitted to fit context window>`);
  }
  return out.join('\n');
}
