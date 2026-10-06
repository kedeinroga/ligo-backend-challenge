export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

/**
 * Calls `work(attempt)` (1 based) up to `policy.maxAttempts` times while
 * `shouldRetry(error)` holds. Before attempt `n + 1` it waits a full jitter delay,
 * `random(0, min(maxDelayMs, baseDelayMs * 2^(n - 1)))`, so concurrent callers
 * do not retry in lockstep. The last error is rethrown.
 */
export async function retryWithBackoff<T>(
  work: (attempt: number) => Promise<T>,
  policy: RetryPolicy,
  shouldRetry: (error: unknown) => boolean,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await work(attempt);
    } catch (error) {
      if (attempt >= policy.maxAttempts || !shouldRetry(error)) {
        throw error;
      }
      const ceiling = Math.min(
        policy.maxDelayMs,
        policy.baseDelayMs * 2 ** (attempt - 1),
      );
      await new Promise((resolve) =>
        setTimeout(resolve, Math.random() * ceiling),
      );
    }
  }
}
