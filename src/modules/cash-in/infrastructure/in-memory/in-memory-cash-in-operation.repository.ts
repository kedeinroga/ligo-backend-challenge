import { CashInOperation } from '../../domain/cash-in-operation.aggregate.js';
import {
  CashInOperationConcurrentlyModifiedException,
  DuplicateCashInOperationException,
} from '../../domain/cash-in-operation.exceptions.js';
import { CashInOperationRepository } from '../../domain/cash-in-operation.repository.js';

interface StoredOperation {
  operation: CashInOperation;
  version: number;
  leaseUntil: Date | null;
  providerCallCount: number;
}

/**
 * Test double with the semantics of the Mongo adapter: unique key per user,
 * atomic lease, version check. It stores copies, never the caller's instance.
 */
export class InMemoryCashInOperationRepository extends CashInOperationRepository {
  private readonly stored = new Map<string, StoredOperation>();

  insertClaimed(operation: CashInOperation, leaseMs: number): Promise<void> {
    const duplicate = this.all().some(
      (s) =>
        s.operation.userId === operation.userId &&
        s.operation.idempotencyKey === operation.idempotencyKey,
    );
    if (duplicate) {
      return Promise.reject(
        new DuplicateCashInOperationException(operation.userId),
      );
    }
    this.stored.set(operation.id, {
      operation: copyOf(operation, operation.version),
      version: operation.version,
      leaseUntil: new Date(Date.now() + leaseMs),
      providerCallCount: 1,
    });
    return Promise.resolve();
  }

  findById(id: string): Promise<CashInOperation | null> {
    return Promise.resolve(this.snapshot(this.stored.get(id)));
  }

  findByIdempotencyKey(
    userId: string,
    idempotencyKey: string,
  ): Promise<CashInOperation | null> {
    const found = this.all().find(
      (s) =>
        s.operation.userId === userId &&
        s.operation.idempotencyKey === idempotencyKey,
    );
    return Promise.resolve(this.snapshot(found));
  }

  claim(id: string, leaseMs: number): Promise<CashInOperation | null> {
    const found = this.stored.get(id);
    return Promise.resolve(
      found && this.isClaimable(found) ? this.take(found, leaseMs) : null,
    );
  }

  claimNextStale(
    createdBefore: Date,
    maxProviderCalls: number,
    leaseMs: number,
    excludedIds: readonly string[],
  ): Promise<CashInOperation | null> {
    const next = this.all()
      .filter(
        (s) =>
          this.isClaimable(s) &&
          !excludedIds.includes(s.operation.id) &&
          s.operation.createdAt < createdBefore &&
          s.providerCallCount < maxProviderCalls,
      )
      .sort(
        (a, b) =>
          a.operation.createdAt.getTime() - b.operation.createdAt.getTime(),
      )[0];
    return Promise.resolve(next ? this.take(next, leaseMs) : null);
  }

  releaseLease(id: string): Promise<void> {
    const found = this.stored.get(id);
    if (found && found.operation.status === 'pending') {
      found.leaseUntil = null;
    }
    return Promise.resolve();
  }

  /** Used by the in-memory unit of work before it applies anything. */
  assertVersion(operation: CashInOperation): void {
    if (this.stored.get(operation.id)?.version !== operation.version) {
      throw new CashInOperationConcurrentlyModifiedException(operation.id);
    }
  }

  /** Used by the in-memory unit of work: stores the new state and bumps the version. */
  apply(operation: CashInOperation): void {
    const found = this.stored.get(operation.id);
    if (!found) {
      throw new CashInOperationConcurrentlyModifiedException(operation.id);
    }
    found.version += 1;
    found.operation = copyOf(operation, found.version);
  }

  private all(): StoredOperation[] {
    return [...this.stored.values()];
  }

  private isClaimable(stored: StoredOperation): boolean {
    return (
      stored.operation.status === 'pending' &&
      (stored.leaseUntil === null || stored.leaseUntil.getTime() < Date.now())
    );
  }

  private take(stored: StoredOperation, leaseMs: number): CashInOperation {
    stored.leaseUntil = new Date(Date.now() + leaseMs);
    stored.providerCallCount += 1;
    return copyOf(stored.operation, stored.version);
  }

  private snapshot(
    stored: StoredOperation | undefined,
  ): CashInOperation | null {
    return stored ? copyOf(stored.operation, stored.version) : null;
  }
}

function copyOf(operation: CashInOperation, version: number): CashInOperation {
  return CashInOperation.rehydrate({
    id: operation.id,
    userId: operation.userId,
    idempotencyKey: operation.idempotencyKey,
    amount: operation.amount,
    paymentMethod: operation.paymentMethod,
    status: operation.status,
    providerChargeId: operation.providerChargeId,
    failureReason: operation.failureReason,
    balanceAfter: operation.balanceAfter,
    createdAt: operation.createdAt,
    updatedAt: operation.updatedAt,
    version,
  });
}
