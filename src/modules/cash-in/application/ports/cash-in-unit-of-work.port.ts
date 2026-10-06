import { CashInOperation } from '../../domain/cash-in-operation.aggregate.js';
import { LedgerEntry } from '../../domain/ledger-entry.js';
import { PaymentNotification } from '../../domain/payment-notification.js';
import { Wallet } from '../../domain/wallet.aggregate.js';

export interface CashInChanges {
  /** Updated with an optimistic version check. */
  readonly operation?: CashInOperation;
  /** Updated with an optimistic version check. */
  readonly wallet?: Wallet;
  /** Inserted; unique by operation id. */
  readonly ledgerEntry?: LedgerEntry;
  /** Inserted; unique by provider event id. */
  readonly notification?: PaymentNotification;
}

export abstract class CashInUnitOfWork {
  /**
   * Persists every change atomically or none.
   * @throws CashInOperationConcurrentlyModifiedException / WalletConcurrentlyModifiedException
   *   when a version check fails or a concurrent transaction conflicts.
   * @throws DuplicatePaymentNotificationException when the notification was already recorded.
   * @throws LedgerEntryAlreadyRecordedException when the operation was already credited.
   */
  abstract commit(changes: CashInChanges, traceId: string): Promise<void>;
}
