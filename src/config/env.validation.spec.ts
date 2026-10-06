import { validateEnv } from './env.validation.js';

describe(validateEnv.name, () => {
  it('accepts the defaults', () => {
    const env = validateEnv({});

    expect(env.OPERATION_LEASE_MS).toBe(15_000);
    expect(env.SETTLEMENT_MAX_ATTEMPTS).toBe(5);
  });

  it('rejects a lease that does not outlast the worst in-request provider time', () => {
    // 3000 * 3 + 1000 * 2 = 11000
    expect(() => validateEnv({ OPERATION_LEASE_MS: '11000' })).toThrow(
      /OPERATION_LEASE_MS/,
    );
    expect(() => validateEnv({ OPERATION_LEASE_MS: '11001' })).not.toThrow();
  });

  it('applies the lease rule to the configured provider budget', () => {
    expect(() =>
      validateEnv({
        PROVIDER_TIMEOUT_MS: '1000',
        PROVIDER_MAX_ATTEMPTS: '3',
        RETRY_MAX_DELAY_MS: '100',
        OPERATION_LEASE_MS: '4000',
      }),
    ).not.toThrow();
  });

  it('rejects a settlement attempts value below 1', () => {
    expect(() => validateEnv({ SETTLEMENT_MAX_ATTEMPTS: '0' })).toThrow(
      /SETTLEMENT_MAX_ATTEMPTS/,
    );
  });
});
