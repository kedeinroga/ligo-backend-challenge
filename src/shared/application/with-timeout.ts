export class TimeoutExceededError extends Error {
  constructor(ms: number) {
    super(`timeout after ${ms}ms`);
    this.name = 'TimeoutExceededError';
  }
}

/** Rejects with `TimeoutExceededError` if `work` does not settle within `ms`. */
export async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutExceededError(ms)), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
