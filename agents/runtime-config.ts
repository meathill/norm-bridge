import { OpenAI } from 'openai';
import {
  setDefaultOpenAIClient,
  setDefaultOpenAIKey,
  setOpenAIAPI,
  setTracingDisabled,
} from '@openai/agents';

/**
 * Single source of truth for "how do we reach an LLM right now":
 *   - reads OPENAI_API_KEY (required)
 *   - reads OPENAI_BASE_URL (optional override for proxies / Azure / DeepSeek / Qwen / etc.)
 *   - reads NORMBRIDGE_AGENT_MODEL / *_COMPILE_MODEL / *_SEARCH_MODEL for per-task overrides
 *
 * Configuration happens once at app boot. Subsequent agent calls go through the
 * default OpenAI client we set on the agents SDK.
 */

export type ApiStyle = 'chat_completions' | 'responses';

export type RuntimeAgentConfig = {
  apiKey: string;
  baseURL: string | null;
  compileModel: string;
  searchModel: string;
  apiStyle: ApiStyle;
};

const DEFAULT_MODEL = 'gpt-4.1-mini';
/** Default to chat completions because most OpenAI-compatible third-party providers
 * (DeepSeek, 通义千问, OpenRouter, Xiaomi MiMo, vLLM, …) only implement that endpoint
 * and return 404 for /v1/responses. OpenAI users can opt in with OPENAI_API_STYLE=responses. */
const DEFAULT_API_STYLE: ApiStyle = 'chat_completions';

export class MissingOpenAiConfigError extends Error {
  constructor(public readonly missingKeys: string[]) {
    super(
      `LLM 配置缺失：未读取到 ${missingKeys.join(', ')}。请在项目根目录的 .env 中配置后重启应用。`,
    );
    this.name = 'MissingOpenAiConfigError';
  }
}

let cached: RuntimeAgentConfig | null = null;

export function configureOpenAiRuntime(): RuntimeAgentConfig {
  if (cached) return cached;

  const apiKey = (process.env['OPENAI_API_KEY'] ?? '').trim();
  if (!apiKey) {
    throw new MissingOpenAiConfigError(['OPENAI_API_KEY']);
  }

  const baseURL = (process.env['OPENAI_BASE_URL'] ?? '').trim() || null;
  const defaultModel = (process.env['NORMBRIDGE_AGENT_MODEL'] ?? '').trim() || DEFAULT_MODEL;
  const compileModel = (process.env['NORMBRIDGE_COMPILE_MODEL'] ?? '').trim() || defaultModel;
  const searchModel = (process.env['NORMBRIDGE_SEARCH_MODEL'] ?? '').trim() || defaultModel;
  const apiStyle = parseApiStyle(process.env['OPENAI_API_STYLE']);

  const clientOptions: ConstructorParameters<typeof OpenAI>[0] = { apiKey };
  if (baseURL) clientOptions.baseURL = baseURL;
  const client = new OpenAI(clientOptions);

  setDefaultOpenAIClient(client);
  setDefaultOpenAIKey(apiKey);
  setOpenAIAPI(apiStyle);
  // TECH_SPEC §18 — never ship prompts to the OpenAI dashboard by default.
  setTracingDisabled(true);

  const config: RuntimeAgentConfig = { apiKey, baseURL, compileModel, searchModel, apiStyle };
  cached = config;
  return config;
}

function parseApiStyle(raw: string | undefined): ApiStyle {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'responses') return 'responses';
  if (v === 'chat_completions' || v === 'chat-completions' || v === '') return DEFAULT_API_STYLE;
  // Unknown value — be loud rather than silent.
  throw new MissingOpenAiConfigError([
    `OPENAI_API_STYLE=${raw} (allowed: chat_completions, responses)`,
  ]);
}

export function getCachedConfig(): RuntimeAgentConfig | null {
  return cached;
}

/** Safe-to-display snapshot (no raw key). */
export type RuntimeAgentStatus = {
  ready: boolean;
  apiKeyMasked: string | null;
  baseURL: string | null;
  compileModel: string;
  searchModel: string;
  apiStyle: ApiStyle;
  errorMessage?: string;
};

export function getRuntimeStatus(): RuntimeAgentStatus {
  try {
    const cfg = configureOpenAiRuntime();
    return {
      ready: true,
      apiKeyMasked: maskKey(cfg.apiKey),
      baseURL: cfg.baseURL,
      compileModel: cfg.compileModel,
      searchModel: cfg.searchModel,
      apiStyle: cfg.apiStyle,
    };
  } catch (err) {
    return {
      ready: false,
      apiKeyMasked: null,
      baseURL: (process.env['OPENAI_BASE_URL'] ?? '').trim() || null,
      compileModel: (process.env['NORMBRIDGE_COMPILE_MODEL'] ?? '').trim() || DEFAULT_MODEL,
      searchModel: (process.env['NORMBRIDGE_SEARCH_MODEL'] ?? '').trim() || DEFAULT_MODEL,
      apiStyle: safeParseApiStyle(process.env['OPENAI_API_STYLE']),
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

function safeParseApiStyle(raw: string | undefined): ApiStyle {
  try {
    return parseApiStyle(raw);
  } catch {
    return DEFAULT_API_STYLE;
  }
}

function maskKey(key: string): string {
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

/** Test helper. */
export function __resetRuntimeForTesting(): void {
  cached = null;
}
