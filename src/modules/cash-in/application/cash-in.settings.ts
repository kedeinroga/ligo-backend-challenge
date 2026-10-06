import { RetryPolicy } from '../../../shared/application/retry.js';

/** Tunables of the cash-in flows, bound from the validated configuration. */
export class CashInSettings {
  constructor(
    /** How long one process owns the right to call the provider for an operation. */
    readonly leaseMs: number,
    /** Reload and reapply a settlement that lost a race with a concurrent write. */
    readonly settlementRetry: RetryPolicy,
  ) {}
}
