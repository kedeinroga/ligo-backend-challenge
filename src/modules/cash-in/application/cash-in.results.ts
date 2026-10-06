import { Money } from '../../../shared/domain/index.js';
import { CashInOperation } from '../domain/cash-in-operation.aggregate.js';
import { CashInStatus } from '../domain/cash-in-status.js';

export interface CashInResult {
  readonly operationId: string;
  readonly status: CashInStatus;
  readonly amount: Money;
  /** Balance right after this credit: only when `completed`. */
  readonly newBalance: Money | null;
  readonly failureReason: string | null;
}

export function toCashInResult(operation: CashInOperation): CashInResult {
  return {
    operationId: operation.id,
    status: operation.status,
    amount: operation.amount,
    newBalance: operation.balanceAfter,
    failureReason: operation.failureReason,
  };
}
