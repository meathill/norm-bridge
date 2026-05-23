/**
 * Bounded retry-with-backoff for a single LLM call. Born from a real failure:
 * the shared MiMo Token Plan endpoint queues requests under server load (docs:
 * "response delays or 429 errors may occur"), so one congested window would
 * permanently lose a section. We retry ONLY transient errors (timeout / 429 /
 * 5xx / network), cool down between attempts, and never retry deterministic
 * failures like schema-parse errors — re-running those just wastes time.
 *
 * Kept as a pure utility (sleep is injectable) so the policy is unit-tested in
 * isolation, without mocking the OpenAI SDK or waiting on real timers.
 */

export type RetryAttemptInfo = {
  /** 1-based index of the retry about to happen (1 = first retry). */
  attempt: number;
  /** Total number of retries configured. */
  retries: number;
  /** How long we'll wait before the upcoming attempt. */
  delayMs: number;
  /** The error that triggered the retry. */
  error: unknown;
};

export type RetryOptions = {
  /** Extra attempts after the first. 0 = no retry. */
  retries: number;
  /** Base cooldown; each further retry doubles it (exponential backoff). */
  cooldownMs: number;
  /** Decide whether a thrown error is worth retrying. */
  isRetryable: (error: unknown) => boolean;
  /** Notified just before each cooldown (for logging). */
  onRetry?: (info: RetryAttemptInfo) => void | Promise<void>;
  /** Injectable for tests; defaults to real setTimeout. */
  sleep?: (ms: number) => Promise<void>;
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const sleep = opts.sleep ?? defaultSleep;
  let lastError: unknown;
  for (let attempt = 0; attempt <= opts.retries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const hasMore = attempt < opts.retries;
      if (!hasMore || !opts.isRetryable(error)) throw error;
      const delayMs = opts.cooldownMs * 2 ** attempt;
      await opts.onRetry?.({ attempt: attempt + 1, retries: opts.retries, delayMs, error });
      await sleep(delayMs);
    }
  }
  // Unreachable (loop either returns or throws), but keeps the type checker happy.
  throw lastError;
}

const RETRYABLE_NETWORK_CODES = new Set(['ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', 'EPIPE']);

/**
 * True for the transient failures a busy OpenAI-compatible endpoint produces:
 * client-side timeouts, 429 (rate/overload), 5xx, and a few network resets.
 * Deliberately false for 4xx (other than 429) and unknown shapes — those won't
 * heal on retry.
 */
export function isRetryableLlmError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as {
    name?: string;
    status?: number;
    code?: string;
    message?: string;
    cause?: { code?: string };
  };

  if (e.name === 'APIConnectionTimeoutError' || e.name === 'APIConnectionError') return true;
  if (typeof e.message === 'string' && /timed?\s*out|timeout/i.test(e.message)) return true;
  if (typeof e.status === 'number' && (e.status === 429 || e.status >= 500)) return true;

  const code = e.code ?? e.cause?.code;
  if (typeof code === 'string' && RETRYABLE_NETWORK_CODES.has(code)) return true;

  return false;
}
