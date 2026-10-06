import {
  ChargeOutcome,
  ChargeRequest,
  PaymentProvider,
} from '../../application/ports/payment-provider.port.js';

/**
 * Test double of the provider port. By default approves with a charge id derived
 * from the operation id (so repeated submissions agree, like a real idempotent
 * provider); `script` queues outcomes for the next charges.
 */
export class FakePaymentProvider extends PaymentProvider {
  readonly calls: ChargeRequest[] = [];
  /** Runs inside `charge`, before it answers: simulates things happening mid call. */
  onCharge: ((request: ChargeRequest) => Promise<void>) | null = null;
  private readonly scripted: ChargeOutcome[] = [];

  script(...outcomes: ChargeOutcome[]): void {
    this.scripted.push(...outcomes);
  }

  async charge(
    request: ChargeRequest,
    _traceId: string,
  ): Promise<ChargeOutcome> {
    this.calls.push(request);
    await this.onCharge?.(request);
    return (
      this.scripted.shift() ?? {
        kind: 'approved',
        providerChargeId: `ch_${request.operationId}`,
      }
    );
  }
}
