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

/**
 * Default cap for blocks shipped in a single LLM call. v0.1 doesn't chunk yet,
 * so a 957-page PDF with ~70 blocks/page (≈ 67k blocks) gets aggressively
 * truncated. 2000 blocks ≈ 25-40 pages. Override via NORMBRIDGE_MAX_BLOCKS_PER_PROMPT.
 */
const DEFAULT_MAX_PROMPT_BLOCKS = 2000;

function envMaxBlocks(): number | null {
  const raw = (process.env['NORMBRIDGE_MAX_BLOCKS_PER_PROMPT'] ?? '').trim();
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export type OpenAiRunnerOptions = {
  /** Override model for this runner only; otherwise reads NORMBRIDGE_COMPILE_MODEL / NORMBRIDGE_AGENT_MODEL. */
  model?: string;
  maxBlocksPerPrompt?: number;
};

export class OpenAiAgentRunner implements AgentRunner {
  readonly id = 'openai-agents';
  private readonly explicitModel?: string;
  private readonly explicitMaxBlocks?: number;

  constructor(opts?: OpenAiRunnerOptions) {
    if (opts?.model) this.explicitModel = opts.model;
    if (opts?.maxBlocksPerPrompt !== undefined) {
      this.explicitMaxBlocks = opts.maxBlocksPerPrompt;
    }
  }

  private get maxBlocks(): number {
    return this.explicitMaxBlocks ?? envMaxBlocks() ?? DEFAULT_MAX_PROMPT_BLOCKS;
  }

  async compile(
    ctx: AgentCompileContext,
    callbacks?: AgentCompileCallbacks,
  ): Promise<AgentCompileResult> {
    const cfg = configureOpenAiRuntime();
    const model = this.explicitModel ?? cfg.compileModel;
    const cap = this.maxBlocks;
    const usedBlocks = Math.min(cap, ctx.textBlocks.length);
    const text = blocksToPromptText(ctx.textBlocks, cap);
    const promptChars = text.length;
    const estTokens = Math.round(promptChars / 4);

    const log = (level: 'info' | 'warn' | 'error', message: string) =>
      callbacks?.onLog?.(level, message);

    await log(
      'info',
      `LLM 编译开始 · model=${model} · endpoint=${cfg.baseURL ?? 'OpenAI 默认'} · ` +
        `api=${cfg.apiStyle} · timeout=${Math.round(cfg.requestTimeoutMs / 1000)}s · retries=${cfg.maxRetries}`,
    );
    await log(
      'info',
      `输入 · 文本块 ${usedBlocks}/${ctx.textBlocks.length} · prompt ≈ ${promptChars} 字符 / ~${estTokens} tokens · 页 ${ctx.pages[0]?.page ?? '?'}–${ctx.pages[ctx.pages.length - 1]?.page ?? '?'}`,
    );
    if (ctx.textBlocks.length > cap) {
      await log(
        'warn',
        `文本块 ${ctx.textBlocks.length} 超过单次上限 ${cap}，已截断处理前 ${cap} 个。` +
          `调 NORMBRIDGE_MAX_BLOCKS_PER_PROMPT 处理更多。`,
      );
    }
    if (estTokens > 24000) {
      await log(
        'warn',
        `prompt 估算 ~${estTokens} tokens，较大，可能超出模型上下文或导致超时。可调小 ` +
          `NORMBRIDGE_MAX_BLOCKS_PER_PROMPT，或调大 NORMBRIDGE_REQUEST_TIMEOUT_MS。`,
      );
    }

    const header = standardHeader(ctx);

    const clauses = await this.runStage<ClauseCompilerOutput>({
      stage: 'clauses',
      log,
      onProgress: callbacks?.onProgress,
      agent: () =>
        new Agent({
          name: 'ClauseCompiler',
          instructions: CLAUSE_INSTRUCTIONS,
          model,
          outputType: clauseCompilerOutputSchema,
        }),
      content: `${header}\n\n${text}`,
      describe: (o) => `${o.clauses.length} 条款`,
    });

    const requirements = await this.runStage<RequirementExtractorOutput>({
      stage: 'requirements',
      log,
      onProgress: callbacks?.onProgress,
      agent: () =>
        new Agent({
          name: 'RequirementExtractor',
          instructions: REQUIREMENT_INSTRUCTIONS,
          model,
          outputType: requirementExtractorOutputSchema,
        }),
      content: `${header}\n\nClause tree:\n${JSON.stringify(clauses.clauses, null, 2)}\n\nText blocks:\n${text}`,
      describe: (o) => `${o.requirements.length} 个 requirement`,
    });

    const references = await this.runStage<ReferenceResolverOutput>({
      stage: 'references',
      log,
      onProgress: callbacks?.onProgress,
      agent: () =>
        new Agent({
          name: 'ReferenceResolver',
          instructions: REFERENCE_INSTRUCTIONS,
          model,
          outputType: referenceResolverOutputSchema,
        }),
      content: `${header}\n\n${text}`,
      describe: (o) => `${o.references.length} 个引用标准`,
    });

    return { clauses, requirements, references };
  }

  private async runStage<T>(args: {
    stage: 'clauses' | 'requirements' | 'references';
    log: (level: 'info' | 'warn' | 'error', message: string) => Promise<void> | void;
    onProgress: AgentCompileCallbacks['onProgress'];
    // biome-ignore lint/suspicious/noExplicitAny: the SDK's Agent output generic varies per stage.
    agent: () => Agent<unknown, any>;
    content: string;
    describe: (output: T) => string;
  }): Promise<T> {
    const { stage, log, onProgress, agent, content, describe } = args;
    await onProgress?.(stage, 0);
    await log('info', `[${stage}] 请求发出，等待响应…（content ≈ ${content.length} 字符）`);
    const t0 = Date.now();
    try {
      const result = await run(agent(), [{ role: 'user', content }]);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      const out = result.finalOutput;
      if (out === undefined || out === null) {
        throw new Error(`stage ${stage} 返回空输出`);
      }
      await log('info', `[${stage}] ✓ ${elapsed}s · ${describe(out as T)}`);
      await onProgress?.(stage, 1);
      return out as T;
    } catch (err) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      await log('error', `[${stage}] ✗ ${elapsed}s · ${describeError(err)}`);
      throw err;
    }
  }
}

/** Extract the useful bits from an OpenAI SDK error (status / code / body) for logging. */
function describeError(err: unknown): string {
  if (!err || typeof err !== 'object') return String(err);
  const e = err as {
    name?: string;
    message?: string;
    status?: number;
    code?: string | number;
    type?: string;
    error?: { message?: string; type?: string; code?: string | number };
    cause?: { message?: string; code?: string };
  };
  const parts: string[] = [];
  if (e.name) parts.push(e.name);
  if (e.status !== undefined) parts.push(`HTTP ${e.status}`);
  if (e.code !== undefined) parts.push(`code=${e.code}`);
  if (e.type) parts.push(`type=${e.type}`);
  const bodyMsg = e.error?.message;
  if (bodyMsg) parts.push(`body="${bodyMsg.slice(0, 300)}"`);
  else if (e.message) parts.push(e.message.slice(0, 300));
  if (e.cause?.code) parts.push(`cause=${e.cause.code}`);
  return parts.join(' · ') || 'unknown error';
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
