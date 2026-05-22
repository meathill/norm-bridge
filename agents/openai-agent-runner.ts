import { Agent, run } from '@openai/agents';
import type { z } from 'zod';
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

// We do NOT use the SDK's structured-output (`outputType`) because third-party
// OpenAI-compatible endpoints (Xiaomi MiMo, DeepSeek, vLLM, …) mishandle strict
// json_schema, producing output the SDK then rejects. Instead each agent is a
// plain chat agent that we instruct to emit JSON; we extract + leniently parse
// it ourselves, which is far more compatible and lets us log the raw output.

const JSON_RULES = `Output ONLY a single JSON object, no markdown fences, no prose before or after.
Quotes must be copied verbatim from the input text. Never invent content.`;

const CLAUSE_INSTRUCTIONS = `You compile a technical-standard PDF section into a clause tree.
The user message contains text blocks tagged by page, e.g. "<page 12>\\n  [id] text".
Detect headings ("N", "N.N", "01 74 19", "SECTION xx") and group the paragraphs under them.
${JSON_RULES}
JSON shape:
{"clauses":[{"localId":"c1","parentLocalId":null,"clauseNo":"1.2","title":"...","pageStart":12,"pageEnd":13,"confidence":0.7,"citationAnchors":[{"page":12,"quote":"verbatim text"}]}]}
- localId: any unique string you choose; parentLocalId: localId of the parent clause or null.
- citationAnchors: 1+ short verbatim quotes (10-200 chars) with their page.`;

const REQUIREMENT_INSTRUCTIONS = `You extract mandatory requirements from a technical standard section.
For each sentence using a modal verb (shall, shall not, must, must not, is required to), emit one requirement.
${JSON_RULES}
JSON shape:
{"requirements":[{"localClauseId":"c1","requirementText":"The contractor shall ...","severity":"mandatory","confidence":0.6,"citationAnchors":[{"page":12,"quote":"verbatim text"}]}]}
- localClauseId: the clause localId from the provided clause tree that owns this requirement (optional).
- severity: "mandatory" for shall/must, "recommended" for should, else "informational".`;

const REFERENCE_INSTRUCTIONS = `You identify other standards referenced from this section.
Look for codes like "IEC 60898-1:2015", "GB/T 14048", "ISO 19650", "ASTM C150", "EN 1991".
${JSON_RULES}
JSON shape:
{"references":[{"referencedStandardCode":"ISO 19650-1","relationType":"normative","confidence":0.6,"citationAnchors":[{"page":12,"quote":"verbatim text"}]}]}
- relationType: normative | informative | equivalent | adopted | replaces | replaced_by | unknown.`;

const DEFAULT_MAX_PROMPT_BLOCKS = 2000;

function envMaxBlocks(): number | null {
  const raw = (process.env['NORMBRIDGE_MAX_BLOCKS_PER_PROMPT'] ?? '').trim();
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export type OpenAiRunnerOptions = {
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
        `prompt 估算 ~${estTokens} tokens，较大，可能超出模型上下文。可调小 NORMBRIDGE_MAX_BLOCKS_PER_PROMPT。`,
      );
    }

    const header = standardHeader(ctx);

    const clauses = await this.runStage({
      stage: 'clauses',
      log,
      onProgress: callbacks?.onProgress,
      model,
      instructions: CLAUSE_INSTRUCTIONS,
      content: `${header}\n\n${text}`,
      schema: clauseCompilerOutputSchema,
      describe: (o) => `${o.clauses.length} 条款`,
    });

    const requirements = await this.runStage({
      stage: 'requirements',
      log,
      onProgress: callbacks?.onProgress,
      model,
      instructions: REQUIREMENT_INSTRUCTIONS,
      content: `${header}\n\nClause tree:\n${JSON.stringify(
        clauses.clauses.map((c) => ({ localId: c.localId, clauseNo: c.clauseNo, title: c.title })),
      )}\n\nText blocks:\n${text}`,
      schema: requirementExtractorOutputSchema,
      describe: (o) => `${o.requirements.length} 个 requirement`,
    });

    const references = await this.runStage({
      stage: 'references',
      log,
      onProgress: callbacks?.onProgress,
      model,
      instructions: REFERENCE_INSTRUCTIONS,
      content: `${header}\n\n${text}`,
      schema: referenceResolverOutputSchema,
      describe: (o) => `${o.references.length} 个引用标准`,
    });

    return { clauses, requirements, references };
  }

  private async runStage<S extends z.ZodTypeAny>(args: {
    stage: 'clauses' | 'requirements' | 'references';
    log: (level: 'info' | 'warn' | 'error', message: string) => Promise<void> | void;
    onProgress: AgentCompileCallbacks['onProgress'];
    model: string;
    instructions: string;
    content: string;
    schema: S;
    describe: (output: z.infer<S>) => string;
  }): Promise<z.infer<S>> {
    const { stage, log, onProgress, model, instructions, content, schema, describe } = args;
    await onProgress?.(stage, 0);
    await log('info', `[${stage}] 请求发出，等待响应…（content ≈ ${content.length} 字符）`);
    const t0 = Date.now();

    const agent = new Agent({ name: `nb-${stage}`, instructions, model });
    let rawText: string;
    try {
      const result = await run(agent, [{ role: 'user', content }]);
      rawText = typeof result.finalOutput === 'string' ? result.finalOutput : '';
    } catch (err) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      await log('error', `[${stage}] ✗ ${elapsed}s · ${describeError(err)}`);
      throw err;
    }

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    await log('info', `[${stage}] 响应到达 ${elapsed}s · ${rawText.length} 字符，开始解析…`);

    const jsonText = extractJsonObject(rawText);
    if (!jsonText) {
      await log('error', `[${stage}] ✗ 响应里找不到 JSON。原始前 400 字：${rawText.slice(0, 400)}`);
      throw new Error(`stage ${stage}: no JSON object in model output`);
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(jsonText);
    } catch (err) {
      await log(
        'error',
        `[${stage}] ✗ JSON.parse 失败：${(err as Error).message}。JSON 前 400 字：${jsonText.slice(0, 400)}`,
      );
      throw new Error(`stage ${stage}: invalid JSON`);
    }

    const result = schema.safeParse(parsedJson);
    if (!result.success) {
      const issues = result.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      await log(
        'error',
        `[${stage}] ✗ schema 校验失败：${issues}。JSON 前 400 字：${jsonText.slice(0, 400)}`,
      );
      throw new Error(`stage ${stage}: schema validation failed (${issues})`);
    }

    await log('info', `[${stage}] ✓ ${elapsed}s · ${describe(result.data)}`);
    await onProgress?.(stage, 1);
    return result.data;
  }
}

/** Pull the outermost JSON object out of a model response (handles ```json fences). */
function extractJsonObject(text: string): string | null {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced?.[1] ?? text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return body.slice(start, end + 1);
}

/** Extract the useful bits from an OpenAI SDK / network error for logging. */
function describeError(err: unknown): string {
  if (!err || typeof err !== 'object') return String(err);
  const e = err as {
    name?: string;
    message?: string;
    status?: number;
    code?: string | number;
    type?: string;
    error?: { message?: string };
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
