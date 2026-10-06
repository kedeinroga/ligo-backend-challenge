import { CashInOperation } from './cash-in-operation.aggregate.js';

/**
 * Persistence of cash-in operations. Settlement (status, wallet, ledger) is not
 * here: it goes through the unit of work so it is atomic.
 */
export abstract class CashInOperationRepository {
  /**
   * Inserts a new operation already leased to the caller (`leaseUntil = now + leaseMs`,
   * `providerCallCount = 1`).
   * @throws DuplicateCashInOperationException on a unique (userId, idempotencyKey) violation.
   */
  abstract insertClaimed(
    operation: CashInOperation,
    leaseMs: number,
  ): Promise<void>;

  abstract findById(id: string): Promise<CashInOperation | null>;

  abstract findByIdempotencyKey(
    userId: string,
    idempotencyKey: string,
  ): Promise<CashInOperation | null>;

  /**
   * Atomically takes the lease of a pending operation whose lease is free or expired.
   * Does not change `version`.
   * @returns the operation, or `null` when someone else holds it or it is final.
   */
  abstract claim(id: string, leaseMs: number): Promise<CashInOperation | null>;

  /**
   * Same atomic claim on the oldest pending operation created before `createdBefore`
   * that was submitted fewer than `maxProviderCalls` times.
   */
  abstract claimNextStale(
    createdBefore: Date,
    maxProviderCalls: number,
    leaseMs: number,
  ): Promise<CashInOperation | null>;

  /**
   * Frees the lease of a still pending operation so an immediate retry can
   * re-submit. A no-op when the operation is already final.
   */
  abstract releaseLease(id: string): Promise<void>;
}
