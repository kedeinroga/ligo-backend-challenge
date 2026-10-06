import { Money } from '../../../shared/domain/index.js';

/** Immutable record of one credit. Unique by operation id: credit exactly once. */
export class LedgerEntry {
  private constructor(
    readonly operationId: string,
    readonly userId: string,
    readonly amount: Money,
    readonly balanceAfter: Money,
    readonly createdAt: Date,
  ) {}

  static record(props: {
    operationId: string;
    userId: string;
    amount: Money;
    balanceAfter: Money;
  }): LedgerEntry {
    return new LedgerEntry(
      props.operationId,
      props.userId,
      props.amount,
      props.balanceAfter,
      new Date(),
    );
  }
}
