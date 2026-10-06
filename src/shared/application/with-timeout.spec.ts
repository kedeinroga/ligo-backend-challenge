import { TimeoutExceededError, withTimeout } from './with-timeout.js';

describe(withTimeout.name, () => {
  it('returns the value of work that settles in time', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 50)).resolves.toBe('ok');
  });

  it('propagates the rejection of work that fails in time', async () => {
    await expect(
      withTimeout(Promise.reject(new Error('boom')), 50),
    ).rejects.toThrow('boom');
  });

  it('rejects with TimeoutExceededError when work outlives the budget', async () => {
    const hung = new Promise<never>(() => undefined);

    await expect(withTimeout(hung, 20)).rejects.toBeInstanceOf(
      TimeoutExceededError,
    );
    await expect(withTimeout(hung, 20)).rejects.toThrow('timeout after 20ms');
  });
});
