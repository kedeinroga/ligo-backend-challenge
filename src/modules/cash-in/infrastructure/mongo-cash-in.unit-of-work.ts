import { Inject, Injectable } from '@nestjs/common';
import { ClientSession, Collection, Db, MongoClient } from 'mongodb';
import {
  DataSourceException,
  DomainException,
} from '../../../shared/domain/index.js';
import { LogsService } from '../../../shared/application/ports/logs.service.js';
import {
  isDuplicateKeyError,
  isTransientTransactionError,
} from '../../../shared/infrastructure/mongo/mongo-errors.js';
import {
  MONGO_CLIENT,
  MONGO_DB,
} from '../../../shared/infrastructure/mongo/mongo.tokens.js';
import {
  CashInChanges,
  CashInUnitOfWork,
} from '../application/ports/cash-in-unit-of-work.port.js';
import {
  CashInOperationConcurrentlyModifiedException,
  LedgerEntryAlreadyRecordedException,
} from '../domain/cash-in-operation.exceptions.js';
import { CashInOperation } from '../domain/cash-in-operation.aggregate.js';
import { LedgerEntry } from '../domain/ledger-entry.js';
import { PaymentNotification } from '../domain/payment-notification.js';
import { DuplicatePaymentNotificationException } from '../domain/payment-notification.exceptions.js';
import { Wallet } from '../domain/wallet.aggregate.js';
import { WalletConcurrentlyModifiedException } from '../domain/wallet.exceptions.js';
import { CashInOperationDocument } from './mappers/cash-in-operation.mapper.js';
import { WalletDocument } from './mappers/wallet.mapper.js';
import { CASH_IN_OPERATIONS_COLLECTION } from './mongo-cash-in-operation.repository.js';
import { WALLETS_COLLECTION } from './mongo-wallet.repository.js';

export const LEDGER_ENTRIES_COLLECTION = 'ledger_entries';
export const PAYMENT_NOTIFICATIONS_COLLECTION = 'payment_notifications';

interface LedgerEntryDocument {
  _id: string;
  userId: string;
  amountMinor: bigint;
  currency: string;
  balanceAfterMinor: bigint;
  createdAt: Date;
}

interface PaymentNotificationDocument {
  _id: string;
  operationId: string;
  type: string;
  result: string;
  receivedAt: Date;
}

/**
 * One Mongo transaction for operation, wallet, ledger entry and notification.
 * The transaction is driven by hand instead of `session.withTransaction`, whose
 * internal retry loop can run for 120 s: here the caller owns the bounded retry.
 */
@Injectable()
export class MongoCashInUnitOfWork extends CashInUnitOfWork {
  private readonly operations: Collection<CashInOperationDocument>;
  private readonly wallets: Collection<WalletDocument>;
  private readonly ledgerEntries: Collection<LedgerEntryDocument>;
  private readonly notifications: Collection<PaymentNotificationDocument>;

  constructor(
    @Inject(MONGO_CLIENT) private readonly client: MongoClient,
    @Inject(MONGO_DB) db: Db,
    private readonly logger: LogsService,
  ) {
    super();
    this.operations = db.collection(CASH_IN_OPERATIONS_COLLECTION);
    this.wallets = db.collection(WALLETS_COLLECTION);
    this.ledgerEntries = db.collection(LEDGER_ENTRIES_COLLECTION);
    this.notifications = db.collection(PAYMENT_NOTIFICATIONS_COLLECTION);
  }

  async commit(changes: CashInChanges, traceId: string): Promise<void> {
    const session = this.client.startSession();
    try {
      session.startTransaction({
        writeConcern: { w: 'majority' },
        readConcern: { level: 'snapshot' },
      });
      await this.apply(changes, session);
      await session.commitTransaction();
    } catch (error) {
      if (session.inTransaction()) {
        await session.abortTransaction().catch(() => undefined);
      }
      throw this.translate(error, changes, traceId);
    } finally {
      await session.endSession();
    }
  }

  private async apply(
    changes: CashInChanges,
    session: ClientSession,
  ): Promise<void> {
    const { notification, operation, wallet, ledgerEntry } = changes;
    if (notification) {
      await this.insertNotification(notification, session);
    }
    if (operation) {
      await this.updateOperation(operation, session);
    }
    if (wallet) {
      await this.updateWallet(wallet, session);
    }
    if (ledgerEntry) {
      await this.insertLedgerEntry(ledgerEntry, session);
    }
  }

  private async insertNotification(
    notification: PaymentNotification,
    session: ClientSession,
  ): Promise<void> {
    try {
      await this.notifications.insertOne(
        {
          _id: notification.notificationId,
          operationId: notification.operationId,
          type: notification.type,
          result: notification.result,
          receivedAt: notification.receivedAt,
        },
        { session },
      );
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new DuplicatePaymentNotificationException(
          notification.notificationId,
          { cause: error },
        );
      }
      throw error;
    }
  }

  /** Lists only the settlement fields: lease and call count are never overwritten. */
  private async updateOperation(
    operation: CashInOperation,
    session: ClientSession,
  ): Promise<void> {
    const result = await this.operations.updateOne(
      { _id: operation.id, version: operation.version },
      {
        $set: {
          status: operation.status,
          providerChargeId: operation.providerChargeId,
          failureReason: operation.failureReason,
          balanceAfterMinor: operation.balanceAfter?.minorUnits ?? null,
          updatedAt: operation.updatedAt,
        },
        $inc: { version: 1 },
      },
      { session },
    );
    if (result.matchedCount === 0) {
      throw new CashInOperationConcurrentlyModifiedException(operation.id);
    }
  }

  private async updateWallet(
    wallet: Wallet,
    session: ClientSession,
  ): Promise<void> {
    const result = await this.wallets.updateOne(
      { _id: wallet.userId, version: wallet.version },
      {
        $set: {
          balanceMinor: wallet.balance.minorUnits,
          updatedAt: wallet.updatedAt,
        },
        $inc: { version: 1 },
      },
      { session },
    );
    if (result.matchedCount === 0) {
      throw new WalletConcurrentlyModifiedException(wallet.userId);
    }
  }

  private async insertLedgerEntry(
    entry: LedgerEntry,
    session: ClientSession,
  ): Promise<void> {
    try {
      await this.ledgerEntries.insertOne(
        {
          _id: entry.operationId,
          userId: entry.userId,
          amountMinor: entry.amount.minorUnits,
          currency: entry.amount.currency,
          balanceAfterMinor: entry.balanceAfter.minorUnits,
          createdAt: entry.createdAt,
        },
        { session },
      );
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new LedgerEntryAlreadyRecordedException(entry.operationId, {
          cause: error,
        });
      }
      throw error;
    }
  }

  private translate(
    error: unknown,
    changes: CashInChanges,
    traceId: string,
  ): Error {
    if (error instanceof DomainException) {
      return error;
    }
    const operationId =
      changes.operation?.id ?? changes.notification?.operationId ?? '';
    if (isTransientTransactionError(error)) {
      this.logger.warn('Cash-in transaction conflict', {
        traceId,
        operationId,
      });
      return new CashInOperationConcurrentlyModifiedException(operationId, {
        cause: error,
      });
    }
    return new DataSourceException('Cash-in transaction failed', {
      cause: error,
    });
  }
}
