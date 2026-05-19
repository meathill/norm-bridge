import { Agent, run, setTracingDisabled } from '@openai/agents';
import { z } from 'zod';
import type { SearchExpansion, SearchResultCard } from '@shared/domain/search';

export type SearchExpandInput = {
  query: string;
  /** Distinct standard codes already in the project (helps the LLM pick relevant ones). */
  knownStandardCodes?: string[];
};

export type SearchSummaryInput = {
  query: string;
  cards: SearchResultCard[];
};

/**
 * Two-step interface so the SearchService can pick mock or openai at construction
 * and call each step in isolation. Keeps the surface narrow and mockable.
 */
export interface SearchRunner {
  readonly id: string;
  expand(input: SearchExpandInput): Promise<SearchExpansion>;
  /** Returns null when the runner refuses (e.g. no API key) — service then skips summary. */
  summarize(input: SearchSummaryInput): Promise<string | null>;
}

/** Pure-JS fallback that doesn't need an API key. */
export class MockSearchRunner implements SearchRunner {
  readonly id = 'mock';

  async expand({ query }: SearchExpandInput): Promise<SearchExpansion> {
    const tokens = tokenize(query);
    return { tokens };
  }

  async summarize(): Promise<string | null> {
    return null;
  }
}

const expansionSchema = z.object({
  tokens: z.array(z.string()).min(1),
  productCategory: z.string().optional(),
  parameters: z.record(z.string(), z.string()).optional(),
});

const EXPANSION_INSTRUCTIONS = `You translate a free-text product description into search tokens
for a SQLite keyword retriever. Output:
- tokens: 3..12 case-insensitive single words or short phrases that should appear in matching clauses,
  including English equivalents of Chinese terms and abbreviations (e.g. "RCBO", "MCB", "circuit breaker").
- productCategory: if the input clearly names a product family, set it (e.g. "miniature circuit breaker").
- parameters: a map of parameter name → value if the input mentions specific ratings (e.g. {"current": "1A"}).
Do NOT invent tokens unrelated to the query.`;

const SUMMARY_INSTRUCTIONS = `You write a 1-2 sentence Chinese summary of which clauses are most
relevant to the user's query, based on the structured results provided.
Refer to clauses by §number. Do NOT invent requirements that are not in the results.`;

export class OpenAiSearchRunner implements SearchRunner {
  readonly id = 'openai-agents';
  private readonly model: string;

  constructor(opts?: { model?: string }) {
    this.model = opts?.model ?? process.env['NORMBRIDGE_AGENT_MODEL'] ?? 'gpt-4.1-mini';
    setTracingDisabled(true);
  }

  async expand({ query, knownStandardCodes }: SearchExpandInput): Promise<SearchExpansion> {
    requireApiKey();
    const agent = new Agent({
      name: 'SearchExpander',
      instructions: EXPANSION_INSTRUCTIONS,
      model: this.model,
      outputType: expansionSchema,
    });
    const context =
      knownStandardCodes && knownStandardCodes.length > 0
        ? `\nReferenced standards already in the project: ${knownStandardCodes.join(', ')}`
        : '';
    const result = await run(agent, [{ role: 'user', content: `Query: ${query}${context}` }]);
    if (!result.finalOutput) throw new Error('search expansion returned no output');
    return result.finalOutput;
  }

  async summarize({ query, cards }: SearchSummaryInput): Promise<string | null> {
    if (!process.env['OPENAI_API_KEY']) return null;
    if (cards.length === 0) return null;
    const agent = new Agent({
      name: 'SearchSummarizer',
      instructions: SUMMARY_INSTRUCTIONS,
      model: this.model,
    });
    const condensed = cards.slice(0, 6).map((c) => ({
      clause: c.clauseNo ?? '',
      title: c.clauseTitle ?? '',
      requirement: c.requirementText.slice(0, 280),
      page: c.page,
    }));
    const result = await run(agent, [
      {
        role: 'user',
        content: `User query: ${query}\n\nTop results:\n${JSON.stringify(condensed, null, 2)}`,
      },
    ]);
    const out = result.finalOutput;
    if (typeof out !== 'string') return null;
    return out.trim();
  }
}

export function resolveSearchRunner(): SearchRunner {
  if (process.env['OPENAI_API_KEY']) return new OpenAiSearchRunner();
  return new MockSearchRunner();
}

function requireApiKey(): void {
  if (!process.env['OPENAI_API_KEY']) {
    throw new Error('OPENAI_API_KEY is not set; install a key or use MockSearchRunner.');
  }
}

const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'of',
  'for',
  'to',
  'in',
  'on',
  '请告诉我',
  '我想知道',
  '关于',
  '请',
  '帮我',
]);

export function tokenize(input: string): string[] {
  const cleaned = input
    .toLowerCase()
    .replace(/[　\s,;.!?，。；！？、:()（）"'"'`]+/g, ' ')
    .trim();
  if (!cleaned) return [];
  const parts = cleaned.split(/\s+/);
  return Array.from(
    new Set(parts.filter((p) => p.length > 0 && !STOPWORDS.has(p) && !/^\d+\.\d+$/.test(p))),
  );
}
