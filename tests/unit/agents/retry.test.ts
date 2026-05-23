import { describe, expect, it, vi } from 'vitest';
import { isRetryableLlmError, withRetry } from '@agents/retry';

const noSleep = () => Promise.resolve();
const alwaysRetry = () => true;

describe('withRetry', () => {
  it('returns on first success without sleeping', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const sleep = vi.fn(noSleep);
    const result = await withRetry(fn, {
      retries: 2,
      cooldownMs: 1000,
      isRetryable: alwaysRetry,
      sleep,
    });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries a retryable error then succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('Request timed out.'))
      .mockResolvedValue('recovered');
    const sleep = vi.fn(noSleep);
    const result = await withRetry(fn, {
      retries: 2,
      cooldownMs: 1000,
      isRetryable: alwaysRetry,
      sleep,
    });
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry a non-retryable error (fails fast)', async () => {
    const err = new Error('schema validation failed');
    const fn = vi.fn().mockRejectedValue(err);
    const sleep = vi.fn(noSleep);
    await expect(
      withRetry(fn, { retries: 3, cooldownMs: 1000, isRetryable: () => false, sleep }),
    ).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('exhausts all retries then throws the last error', async () => {
    const err = new Error('still timing out');
    const fn = vi.fn().mockRejectedValue(err);
    const sleep = vi.fn(noSleep);
    await expect(
      withRetry(fn, { retries: 2, cooldownMs: 500, isRetryable: alwaysRetry, sleep }),
    ).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('applies exponential backoff and reports each attempt', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('overloaded'));
    const sleep = vi.fn(noSleep);
    const attempts: number[] = [];
    await expect(
      withRetry(fn, {
        retries: 3,
        cooldownMs: 1000,
        isRetryable: alwaysRetry,
        sleep,
        onRetry: ({ attempt, delayMs }) => {
          attempts.push(attempt);
          expect(delayMs).toBe(1000 * 2 ** (attempt - 1));
        },
      }),
    ).rejects.toThrow('overloaded');
    expect(attempts).toEqual([1, 2, 3]);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000, 4000]);
  });

  it('with retries=0 behaves like a single attempt', async () => {
    const err = new Error('Request timed out.');
    const fn = vi.fn().mockRejectedValue(err);
    const sleep = vi.fn(noSleep);
    await expect(
      withRetry(fn, { retries: 0, cooldownMs: 1000, isRetryable: alwaysRetry, sleep }),
    ).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe('isRetryableLlmError', () => {
  it('retries client timeouts', () => {
    expect(
      isRetryableLlmError(Object.assign(new Error('x'), { name: 'APIConnectionTimeoutError' })),
    ).toBe(true);
    expect(isRetryableLlmError(new Error('Request timed out.'))).toBe(true);
    expect(isRetryableLlmError(Object.assign(new Error('x'), { name: 'APIConnectionError' }))).toBe(
      true,
    );
  });

  it('retries 429 and 5xx', () => {
    expect(isRetryableLlmError({ status: 429 })).toBe(true);
    expect(isRetryableLlmError({ status: 500 })).toBe(true);
    expect(isRetryableLlmError({ status: 503 })).toBe(true);
  });

  it('retries transient network codes (incl. nested cause)', () => {
    expect(isRetryableLlmError({ code: 'ECONNRESET' })).toBe(true);
    expect(isRetryableLlmError({ code: 'ETIMEDOUT' })).toBe(true);
    expect(isRetryableLlmError({ cause: { code: 'EAI_AGAIN' } })).toBe(true);
  });

  it('does NOT retry deterministic failures', () => {
    expect(isRetryableLlmError({ status: 400 })).toBe(false);
    expect(isRetryableLlmError({ status: 401 })).toBe(false);
    expect(isRetryableLlmError(new Error('schema validation failed'))).toBe(false);
    expect(isRetryableLlmError({ code: 'ENOTFOUND' })).toBe(false);
    expect(isRetryableLlmError(null)).toBe(false);
    expect(isRetryableLlmError('boom')).toBe(false);
  });
});
