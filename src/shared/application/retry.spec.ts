import { retryWithBackoff, RetryPolicy } from './retry.js';

const policy: RetryPolicy = { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5 };
const always = (): boolean => true;

describe(retryWithBackoff.name, () => {
  it('returns the first success without retrying', async () => {
    const work = vi.fn(async () => 'ok');

    await expect(retryWithBackoff(work, policy, always)).resolves.toBe('ok');
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('retries a retryable failure and passes the attempt number', async () => {
    const work = vi
      .fn<(attempt: number) => Promise<string>>()
      .mockRejectedValueOnce(new Error('busy'))
      .mockResolvedValueOnce('ok');

    await expect(retryWithBackoff(work, policy, always)).resolves.toBe('ok');
    expect(work.mock.calls.map(([attempt]) => attempt)).toEqual([1, 2]);
  });

  it('rethrows the last error once the attempts are exhausted', async () => {
    const work = vi.fn(async () => {
      throw new Error('still busy');
    });

    await expect(retryWithBackoff(work, policy, always)).rejects.toThrow(
      'still busy',
    );
    expect(work).toHaveBeenCalledTimes(3);
  });

  it('does not retry an error the predicate rejects', async () => {
    const work = vi.fn(async () => {
      throw new Error('fatal');
    });

    await expect(retryWithBackoff(work, policy, () => false)).rejects.toThrow(
      'fatal',
    );
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('waits a jittered delay capped by maxDelayMs between attempts', async () => {
    const timeout = vi.spyOn(globalThis, 'setTimeout');
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const work = vi.fn(async () => {
      throw new Error('busy');
    });

    await expect(
      retryWithBackoff(
        work,
        { maxAttempts: 4, baseDelayMs: 2, maxDelayMs: 5 },
        always,
      ),
    ).rejects.toThrow('busy');

    const delays = timeout.mock.calls.map(([, ms]) => ms);
    expect(delays).toEqual([2, 4, 5]);
    vi.restoreAllMocks();
  });
});
