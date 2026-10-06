import { Money } from '../../../../shared/domain/index.js';

export interface ChargeRequest {
  /** Sent as the provider idempotency key: a repeated submission never charges twice. */
  readonly operationId: string;
  readonly userId: string;
  readonly amount: Money;
  readonly paymentMethod: string;
}

export type UnknownOutcomeCause = 'timeout' | 'unavailable' | 'error';

export type ChargeOutcome =
  | { readonly kind: 'approved'; readonly providerChargeId: string }
  | { readonly kind: 'declined'; readonly reason: string }
  | { readonly kind: 'unknown'; readonly cause: UnknownOutcomeCause };

export abstract class PaymentProvider {
  /**
   * Submits a charge. Idempotent by `operationId`. Never throws: a failure to
   * learn the result is an `unknown` outcome (the charge may or may not have
   * happened), never a decline.
   */
  abstract charge(
    request: ChargeRequest,
    traceId: string,
  ): Promise<ChargeOutcome>;
}
