import { LogsService } from '../../../shared/application/ports/logs.service.js';
import { retryWithBackoff } from '../../../shared/application/retry.js';
import { ConcurrencyException } from '../../../shared/domain/index.js';
import { CashInOperation } from '../domain/cash-in-operation.aggregate.js';
import { CashInOperationNotFoundException } from '../domain/cash-in-operation.exceptions.js';
import { CashInOperationRepository } from '../domain/cash-in-operation.repository.js';
import {
  PaymentNotification,
  PaymentNotificationType,
} from '../domain/payment-notification.js';
import { TransitionResult } from '../domain/transition-result.js';
import { WalletNotFoundException } from '../domain/wallet.exceptions.js';
import { WalletRepository } from '../domain/wallet.repository.js';
import { CashInSettings } from './cash-in.settings.js';
import {
  CashInChanges,
  CashInUnitOfWork,
} from './ports/cash-in-unit-of-work.port.js';
import {
  ChargeOutcome,
  PaymentProvider,
} from './ports/payment-provider.port.js';

export interface SettlementContext {
  readonly traceId: string;
  /** Set when the outcome comes from a provider notification: recorded in the same commit. */
  readonly notification?: {
    readonly notificationId: string;
    readonly type: PaymentNotificationType;
  };
}

export interface Settlement {
  readonly operation: CashInOperation;
  readonly result: TransitionResult;
}

/**
 * Orchestration shared by the handlers that call the provider or apply one of
 * its outcomes. Business rules stay in the aggregates; this decides which
 * aggregate method a provider outcome maps to and persists the result.
 */
export class CashInProcessor {
  constructor(
    private readonly operations: CashInOperationRepository,
    private readonly wallets: WalletRepository,
    private readonly unitOfWork: CashInUnitOfWork,
    private readonly provider: PaymentProvider,
    private readonly settings: CashInSettings,
    private readonly logger: LogsService,
  ) {}

  /**
   * Submits the charge and settles the operation. The caller already holds the lease.
   * Once the provider has been called this never throws: whatever goes wrong the
   * operation stays pending (the provider may have charged) and a retry, a webhook
   * or the reconciler resolves it with the same provider key.
   */
  async chargeAndSettle(
    operation: CashInOperation,
    traceId: string,
  ): Promise<CashInOperation> {
    const context = {
      traceId,
      operationId: operation.id,
      userId: operation.userId,
    };
    const outcome = await this.provider.charge(
      {
        operationId: operation.id,
        userId: operation.userId,
        amount: operation.amount,
        paymentMethod: operation.paymentMethod,
      },
      traceId,
    );
    if (outcome.kind === 'unknown') {
      this.logger.warn('Provider outcome unknown, operation stays pending', {
        ...context,
        cause: outcome.cause,
      });
      await this.releaseLeaseQuietly(operation.id, traceId);
      return operation;
    }
    try {
      return (await this.settleOutcome(operation.id, outcome, traceId))
        .operation;
    } catch (error) {
      this.logger.error(
        'Provider outcome known but not persisted, operation stays pending',
        error,
        context,
      );
      await this.releaseLeaseQuietly(operation.id, traceId);
      return operation;
    }
  }

  settleApproved(
    operationId: string,
    providerChargeId: string,
    context: SettlementContext,
  ): Promise<Settlement> {
    return retryWithBackoff(
      () => this.completeOnce(operationId, providerChargeId, context),
      this.settings.settlementRetry,
      isConcurrencyException,
    );
  }

  settleDeclined(
    operationId: string,
    reason: string,
    context: SettlementContext,
  ): Promise<Settlement> {
    return retryWithBackoff(
      () => this.failOnce(operationId, reason, context),
      this.settings.settlementRetry,
      isConcurrencyException,
    );
  }

  private settleOutcome(
    operationId: string,
    outcome: Exclude<ChargeOutcome, { kind: 'unknown' }>,
    traceId: string,
  ): Promise<Settlement> {
    return outcome.kind === 'approved'
      ? this.settleApproved(operationId, outcome.providerChargeId, { traceId })
      : this.settleDeclined(operationId, outcome.reason, { traceId });
  }

  private async completeOnce(
    operationId: string,
    providerChargeId: string,
    context: SettlementContext,
  ): Promise<Settlement> {
    const operation = await this.loadOperation(operationId);
    const wallet = await this.wallets.findByUserId(operation.userId);
    if (!wallet) {
      throw new WalletNotFoundException(operation.userId);
    }
    const completion = operation.markCompleted(providerChargeId, wallet);
    const changes: CashInChanges =
      completion.result === 'applied'
        ? { operation, wallet, ledgerEntry: completion.ledgerEntry }
        : {};
    await this.commit(operation, completion.result, changes, context);

    const logContext = this.logContext(operation, context);
    if (completion.result === 'applied') {
      this.logger.info('Cash-in completed', {
        ...logContext,
        amount: operation.amount.toDecimalString(),
        balanceAfter: operation.balanceAfter?.toDecimalString(),
      });
    } else if (completion.result === 'ignored') {
      this.logger.info('Duplicate provider confirmation ignored', logContext);
    } else {
      this.logger.error(
        'Conflicting provider outcome: charged but the operation is failed, manual review',
        undefined,
        logContext,
      );
    }
    return { operation, result: completion.result };
  }

  private async failOnce(
    operationId: string,
    reason: string,
    context: SettlementContext,
  ): Promise<Settlement> {
    const operation = await this.loadOperation(operationId);
    const result = operation.markFailed(reason);
    await this.commit(
      operation,
      result,
      result === 'applied' ? { operation } : {},
      context,
    );

    const logContext = this.logContext(operation, context);
    if (result === 'applied') {
      this.logger.info('Cash-in failed', { ...logContext, reason });
    } else if (result === 'conflict') {
      this.logger.error(
        'Conflicting provider outcome: declined but the operation is completed',
        undefined,
        logContext,
      );
    }
    return { operation, result };
  }

  /** Nothing to persist (no change, no notification to record) means no commit. */
  private async commit(
    operation: CashInOperation,
    result: TransitionResult,
    changes: CashInChanges,
    context: SettlementContext,
  ): Promise<void> {
    const notification = context.notification
      ? PaymentNotification.record({
          ...context.notification,
          operationId: operation.id,
          result,
        })
      : undefined;
    if (result !== 'applied' && !notification) {
      return;
    }
    await this.unitOfWork.commit({ ...changes, notification }, context.traceId);
  }

  private async loadOperation(operationId: string): Promise<CashInOperation> {
    const operation = await this.operations.findById(operationId);
    if (!operation) {
      throw new CashInOperationNotFoundException(operationId);
    }
    return operation;
  }

  /** A failure here is harmless: the lease expires on its own. */
  private async releaseLeaseQuietly(
    operationId: string,
    traceId: string,
  ): Promise<void> {
    try {
      await this.operations.releaseLease(operationId);
    } catch (error) {
      this.logger.error('Could not release the operation lease', error, {
        traceId,
        operationId,
      });
    }
  }

  private logContext(
    operation: CashInOperation,
    context: SettlementContext,
  ): { traceId: string; operationId: string; userId: string } {
    return {
      traceId: context.traceId,
      operationId: operation.id,
      userId: operation.userId,
    };
  }
}

function isConcurrencyException(error: unknown): boolean {
  return error instanceof ConcurrencyException;
}
