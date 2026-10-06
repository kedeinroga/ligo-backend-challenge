import { AppConfigService } from '../../../config/app-config.service.js';
import { Money } from '../../../shared/domain/index.js';
import { NoopLogsService } from '../../../shared/infrastructure/in-memory/noop-logs.service.js';
import { ChargeRequest } from '../application/ports/payment-provider.port.js';
import { SimulatedPaymentProvider } from './simulated-payment-provider.js';
import {
  ProviderAnswer,
  ProviderUnavailableError,
  SimulatedProviderBackend,
} from './simulated-provider/simulated-provider.backend.js';

const MAX_ATTEMPTS = 3;
const config = {
  providerTimeoutMs: 30,
  providerMaxAttempts: MAX_ATTEMPTS,
  retryBaseDelayMs: 1,
  retryMaxDelayMs: 2,
} as AppConfigService;

const request: ChargeRequest = {
  operationId: 'op_1',
  userId: 'usr_1',
  amount: Money.of('100', 'PEN'),
  paymentMethod: 'card_xyz',
};

function providerWith(
  submit: (request: ChargeRequest) => Promise<ProviderAnswer>,
): { provider: SimulatedPaymentProvider; submit: ReturnType<typeof vi.fn> } {
  const spy = vi.fn(submit);
  const backend = { submit: spy } as unknown as SimulatedProviderBackend;
  return {
    provider: new SimulatedPaymentProvider(
      backend,
      config,
      new NoopLogsService(),
    ),
    submit: spy,
  };
}

describe(SimulatedPaymentProvider.name, () => {
  it('maps an approved answer keeping the provider charge id', async () => {
    const { provider, submit } = providerWith(async () => ({
      outcome: 'approved',
      providerChargeId: 'ch_1',
    }));

    await expect(provider.charge(request, 'trace')).resolves.toEqual({
      kind: 'approved',
      providerChargeId: 'ch_1',
    });
    expect(submit).toHaveBeenCalledWith(request);
  });

  it('maps a declined answer keeping the reason', async () => {
    const { provider } = providerWith(async () => ({
      outcome: 'declined',
      reason: 'insufficient_funds',
    }));

    await expect(provider.charge(request, 'trace')).resolves.toEqual({
      kind: 'declined',
      reason: 'insufficient_funds',
    });
  });

  it('returns unknown on timeout without retrying', async () => {
    const { provider, submit } = providerWith(
      () => new Promise<ProviderAnswer>(() => undefined),
    );

    await expect(provider.charge(request, 'trace')).resolves.toEqual({
      kind: 'unknown',
      cause: 'timeout',
    });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('retries an unavailable provider up to the max attempts, then returns unknown', async () => {
    const { provider, submit } = providerWith(async () => {
      throw new ProviderUnavailableError();
    });

    await expect(provider.charge(request, 'trace')).resolves.toEqual({
      kind: 'unknown',
      cause: 'unavailable',
    });
    expect(submit).toHaveBeenCalledTimes(MAX_ATTEMPTS);
  });

  it('succeeds when the provider recovers within the attempts, with the same request', async () => {
    let calls = 0;
    const { provider, submit } = providerWith(async () => {
      calls += 1;
      if (calls < 2) {
        throw new ProviderUnavailableError();
      }
      return { outcome: 'approved', providerChargeId: 'ch_1' };
    });

    await expect(provider.charge(request, 'trace')).resolves.toMatchObject({
      kind: 'approved',
    });
    expect(submit.mock.calls.map(([sent]) => sent.operationId)).toEqual([
      'op_1',
      'op_1',
    ]);
  });

  it('returns unknown without retrying on an unexpected error', async () => {
    const { provider, submit } = providerWith(async () => {
      throw new Error('boom');
    });

    await expect(provider.charge(request, 'trace')).resolves.toEqual({
      kind: 'unknown',
      cause: 'error',
    });
    expect(submit).toHaveBeenCalledTimes(1);
  });
});
