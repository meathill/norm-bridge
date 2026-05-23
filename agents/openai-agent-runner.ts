import { Agent, run } from '@openai/agents';
import {
  combinedCompileOutputSchema,
  type CombinedCompileOutput,
} from '@shared/schemas/agent-outputs';
import type { PdfTextBlock } from '@shared/domain/pdf-extract';
import type {
  AgentCompileCallbacks,
  AgentCompileContext,
  AgentCompileResult,
  AgentRunner,
} from './agent-runner';
import { configureOpenAiRuntime } from './runtime-config';
import { isRetryableLlmError, withRetry } from './retry';

// We do NOT use the SDK's structured-output (`outputType`) because third-party
// OpenAI-compatible endpoints (Xiaomi MiMo, DeepSeek, vLLM, …) mishandle strict
// json_schema. And we do everything in ONE call per section: three sequential
// calls each re-sent the full text, which on a slow endpoint blew the timeout.

const INSTRUCTIONS = `You compile one section of a technical-standard PDF into structured data.
The user message contains text lines grouped by page, e.g. "<page 12>\\n  some text".
Produce, in a SINGLE JSON object, three arrays:

1. clauses — the clause tree. Detect headings ("N", "N.N", "01 74 19", "SECTION xx")
   and group paragraphs under them.
2. requirements — for every sentence using a modal verb (shall / shall not / must /
   must not / is required to), one requirement.
3. references — other standards referenced (e.g. "ISO 19650-1", "IEC 60898-1:2015",
   "ASTM C150", "EN 1991").

Output ONLY the JSON object, no markdown fences, no prose. Quotes must be copied
verbatim from the input. Never invent content.

JSON shape:
{
  "clauses":[{"localId":"c1","parentLocalId":null,"clauseNo":"1.2","title":"...","pageStart":12,"pageEnd":13,"confidence":0.7,"citationAnchors":[{"page":12,"quote":"verbatim text"}]}],
  "requirements":[{"localClauseId":"c1","requirementText":"The contractor shall ...","severity":"mandatory","confidence":0.6,"citationAnchors":[{"page":12,"quote":"verbatim text"}]}],
  "references":[{"referencedStandardCode":"ISO 19650-1","relationType":"normative","confidence":0.6,"citationAnchors":[{"page":12,"quote":"verbatim text"}]}]
}

- localId: any unique string; parentLocalId: a clause localId or null.
- localClauseId: the clause localId that owns the requirement (optional).
- severity: "mandatory" for shall/must, "recommended" for should, else "informational".
- relationType: normative | informative | equivalent | adopted | replaces | replaced_by | unknown.
- citationAnchors: 1+ short verbatim quotes (10-200 chars) with their page.
- If a section has nothing of a kind, return an empty array for it.`;

/** Default block cap per section call. Smaller = faster + far less likely to time out. */
const DEFAULT_MAX_PROMPT_BLOCKS = 800;

function envMaxBlocks(): number | null {
  const raw = (process.env['NORMBRIDGE_MAX_BLOCKS_PER_PROMPT'] ?? '').trim();
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/**
 * Per-section retry policy. One section = one combined LLM call, so these read
 * as "section retries" to the user even though they wrap a single request.
 * Defaults: retry once, cooling down 20s first (then exponential backoff). Set
 * NORMBRIDGE_SECTION_RETRIES=0 to disable.
 */
const DEFAULT_SECTION_RETRIES = 1;
const DEFAULT_RETRY_COOLDOWN_MS = 20_000;

function envInt(name: string, fallback: number, min: number): number {
  const n = Number.parseInt((process.env[name] ?? '').trim(), 10);
  return Number.isFinite(n) && n >= min ? n : fallback;
}

function sectionRetries(): number {
  return envInt('NORMBRIDGE_SECTION_RETRIES', DEFAULT_SECTION_RETRIES, 0);
}

function retryCooldownMs(): number {
  return envInt('NORMBRIDGE_RETRY_COOLDOWN_MS', DEFAULT_RETRY_COOLDOWN_MS, 0);
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
    const content = `${standardHeader(ctx)}\n\n${text}`;
    const estTokens = Math.round(content.length / 4);

    const log = (level: 'info' | 'warn' | 'error', message: string) =>
      callbacks?.onLog?.(level, message);

    await log(
      'info',
      `LLM 编译开始 · model=${model} · endpoint=${cfg.baseURL ?? 'OpenAI 默认'} · ` +
        `api=${cfg.apiStyle} · timeout=${Math.round(cfg.requestTimeoutMs / 1000)}s · retries=${cfg.maxRetries}`,
    );
    await log(
      'info',
      `输入 · 文本块 ${usedBlocks}/${ctx.textBlocks.length} · prompt ≈ ${content.length} 字符 / ~${estTokens} tokens · 页 ${ctx.pages[0]?.page ?? '?'}–${ctx.pages[ctx.pages.length - 1]?.page ?? '?'}`,
    );
    if (ctx.textBlocks.length > cap) {
      await log(
        'warn',
        `文本块 ${ctx.textBlocks.length} 超过单次上限 ${cap}，已截断处理前 ${cap} 个。` +
          `调 NORMBRIDGE_MAX_BLOCKS_PER_PROMPT 处理更多（但更慢、更易超时）。`,
      );
    }
    if (estTokens > 16000) {
      await log(
        'warn',
        `prompt 估算 ~${estTokens} tokens，偏大，慢端点可能超时。可调小 NORMBRIDGE_MAX_BLOCKS_PER_PROMPT。`,
      );
    }

    await callbacks?.onProgress?.('clauses', 0);
    await log(
      'info',
      `[compile] 请求发出，等待响应…（content ≈ ${content.length} 字符，单次返回全部）`,
    );
    const t0 = Date.now();

    const agent = new Agent({ name: 'nb-compile', instructions: INSTRUCTIONS, model });
    const retries = sectionRetries();
    let rawText: string;
    try {
      const result = await withRetry(() => run(agent, [{ role: 'user', content }]), {
        retries,
        cooldownMs: retryCooldownMs(),
        isRetryable: isRetryableLlmError,
        onRetry: async ({ attempt, retries: total, delayMs, error }) => {
          await log(
            'warn',
            `[compile] ⏳ 第 ${attempt}/${total} 次重试 · 冷却 ${Math.round(delayMs / 1000)}s 后再试` +
              `（多为端点高负载，瞬时可恢复）· 上次：${describeError(error)}`,
          );
        },
      });
      rawText = typeof result.finalOutput === 'string' ? result.finalOutput : '';
    } catch (err) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      const tail = retries > 0 ? `（已重试 ${retries} 次仍失败）` : '';
      await log('error', `[compile] ✗ ${elapsed}s · ${describeError(err)}${tail}`);
      throw err;
    }

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    await log('info', `[compile] 响应到达 ${elapsed}s · ${rawText.length} 字符，开始解析…`);

    const parsed = parseCombined(rawText);
    if (!parsed.ok) {
      await log(
        'error',
        `[compile] ✗ 解析失败：${parsed.error}。原始前 400 字：${rawText.slice(0, 400)}`,
      );
      throw new Error(`compile parse failed: ${parsed.error}`);
    }
    const data = parsed.data;
    await log(
      'info',
      `[compile] ✓ ${elapsed}s · ${data.clauses.length} 条款 / ${data.requirements.length} requirement / ${data.references.length} 引用`,
    );
    await callbacks?.onProgress?.('references', 1);

    return {
      clauses: { clauses: data.clauses },
      requirements: { requirements: data.requirements },
      references: { references: data.references },
    };
  }
}

type ParseResult = { ok: true; data: CombinedCompileOutput } | { ok: false; error: string };

function parseCombined(rawText: string): ParseResult {
  const jsonText = extractJsonObject(rawText);
  if (!jsonText) return { ok: false, error: '响应里找不到 JSON 对象' };
  let json: unknown;
  try {
    json = JSON.parse(jsonText);
  } catch (err) {
    return { ok: false, error: `JSON.parse 失败：${(err as Error).message}` };
  }
  const result = combinedCompileOutputSchema.safeParse(json);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    return { ok: false, error: `schema 校验失败：${issues}` };
  }
  return { ok: true, data: result.data };
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
      // No block-id prefix: the model cites by page + verbatim quote (we resolve
      // the block by quote-matching), so ids were pure token bloat (~4× the text).
      if (b.text.trim()) out.push(`  ${b.text}`);
    }
  }
  if (blocks.length > cap) {
    out.push(`<truncated: ${blocks.length - cap} block(s) omitted to fit context window>`);
  }
  return out.join('\n');
}
