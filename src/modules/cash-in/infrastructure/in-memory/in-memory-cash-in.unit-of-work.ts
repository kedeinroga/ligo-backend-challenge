import {
  CashInChanges,
  CashInUnitOfWork,
} from '../../application/ports/cash-in-unit-of-work.port.js';
import { LedgerEntryAlreadyRecordedException } from '../../domain/cash-in-operation.exceptions.js';
import { LedgerEntry } from '../../domain/ledger-entry.js';
import { PaymentNotification } from '../../domain/payment-notification.js';
import { DuplicatePaymentNotificationException } from '../../domain/payment-notification.exceptions.js';
import { InMemoryCashInOperationRepository } from './in-memory-cash-in-operation.repository.js';
import { InMemoryWalletRepository } from './in-memory-wallet.repository.js';

/**
 * Test double: validates every precondition (unique ids, versions) before
 * applying anything, so a failed commit changes nothing, like a transaction.
 */
export class InMemoryCashInUnitOfWork extends CashInUnitOfWork {
  readonly ledgerEntries = new Map<string, LedgerEntry>();
  readonly notifications = new Map<string, PaymentNotification>();
  private nextFailure: Error | null = null;

  constructor(
    private readonly operations: InMemoryCashInOperationRepository,
    private readonly wallets: InMemoryWalletRepository,
  ) {
    super();
  }

  /** Makes the next commit throw `error` without applying anything. */
  failNextCommitWith(error: Error): void {
    this.nextFailure = error;
  }

  commit(changes: CashInChanges, _traceId: string): Promise<void> {
    try {
      this.failIfScripted();
      this.assertPreconditions(changes);
    } catch (error) {
      return Promise.reject(error);
    }
    const { notification, operation, wallet, ledgerEntry } = changes;
    if (notification) {
      this.notifications.set(notification.notificationId, notification);
    }
    if (operation) {
      this.operations.apply(operation);
    }
    if (wallet) {
      this.wallets.apply(wallet);
    }
    if (ledgerEntry) {
      this.ledgerEntries.set(ledgerEntry.operationId, ledgerEntry);
    }
    return Promise.resolve();
  }

  private failIfScripted(): void {
    if (this.nextFailure) {
      const error = this.nextFailure;
      this.nextFailure = null;
      throw error;
    }
  }

  private assertPreconditions(changes: CashInChanges): void {
    const { notification, operation, wallet, ledgerEntry } = changes;
    if (notification && this.notifications.has(notification.notificationId)) {
      throw new DuplicatePaymentNotificationException(
        notification.notificationId,
      );
    }
    if (operation) {
      this.operations.assertVersion(operation);
    }
    if (wallet) {
      this.wallets.assertVersion(wallet);
    }
    if (ledgerEntry && this.ledgerEntries.has(ledgerEntry.operationId)) {
      throw new LedgerEntryAlreadyRecordedException(ledgerEntry.operationId);
    }
  }
}
