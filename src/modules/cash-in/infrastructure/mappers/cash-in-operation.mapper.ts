import { Money } from '../../../../shared/domain/index.js';
import { CashInOperation } from '../../domain/cash-in-operation.aggregate.js';
import { CashInStatus } from '../../domain/cash-in-status.js';

export interface CashInOperationDocument {
  _id: string;
  userId: string;
  idempotencyKey: string;
  paymentMethod: string;
  currency: string;
  amountMinor: bigint;
  status: CashInStatus;
  providerChargeId: string | null;
  failureReason: string | null;
  balanceAfterMinor: bigint | null;
  /** Persistence only: exclusive right to call the provider until this instant. */
  leaseUntil: Date | null;
  /** Persistence only: how many times the charge was submitted. */
  providerCallCount: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export type SubmissionState = Pick<
  CashInOperationDocument,
  'leaseUntil' | 'providerCallCount'
>;

export function toCashInOperationDocument(
  operation: CashInOperation,
  submission: SubmissionState,
): CashInOperationDocument {
  return {
    _id: operation.id,
    userId: operation.userId,
    idempotencyKey: operation.idempotencyKey,
    paymentMethod: operation.paymentMethod,
    currency: operation.amount.currency,
    amountMinor: operation.amount.minorUnits,
    status: operation.status,
    providerChargeId: operation.providerChargeId,
    failureReason: operation.failureReason,
    balanceAfterMinor: operation.balanceAfter?.minorUnits ?? null,
    ...submission,
    version: operation.version,
    createdAt: operation.createdAt,
    updatedAt: operation.updatedAt,
  };
}

export function toCashInOperation(
  document: CashInOperationDocument,
): CashInOperation {
  return CashInOperation.rehydrate({
    id: document._id,
    userId: document.userId,
    idempotencyKey: document.idempotencyKey,
    amount: Money.ofMinor(document.amountMinor, document.currency),
    paymentMethod: document.paymentMethod,
    status: document.status,
    providerChargeId: document.providerChargeId,
    failureReason: document.failureReason,
    balanceAfter:
      document.balanceAfterMinor === null
        ? null
        : Money.ofMinor(document.balanceAfterMinor, document.currency),
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    version: document.version,
  });
}
