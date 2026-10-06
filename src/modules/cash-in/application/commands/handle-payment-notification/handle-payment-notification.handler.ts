import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { LogsService } from '../../../../../shared/application/ports/logs.service.js';
import {
  DataInputException,
  Money,
} from '../../../../../shared/domain/index.js';
import { CashInOperationNotFoundException } from '../../../domain/cash-in-operation.exceptions.js';
import { CashInOperationRepository } from '../../../domain/cash-in-operation.repository.js';
import { PaymentNotification } from '../../../domain/payment-notification.js';
import { DuplicatePaymentNotificationException } from '../../../domain/payment-notification.exceptions.js';
import { TransitionResult } from '../../../domain/transition-result.js';
import { CashInProcessor } from '../../cash-in-processor.js';
import { PaymentNotificationResult } from '../../cash-in.results.js';
import { CashInUnitOfWork } from '../../ports/cash-in-unit-of-work.port.js';
import { HandlePaymentNotificationCommand } from './handle-payment-notification.command.js';

/**
 * Webhooks are untrusted, repeated and unordered: each one is an idempotent
 * state transition, deduplicated by the provider event id in the same
 * transaction that applies it. Late or contradicting ones are acknowledged
 * (never rejected, or the provider would retry forever) and logged.
 */
@CommandHandler(HandlePaymentNotificationCommand)
export class HandlePaymentNotificationHandler implements ICommandHandler<HandlePaymentNotificationCommand> {
  constructor(
    private readonly operations: CashInOperationRepository,
    private readonly unitOfWork: CashInUnitOfWork,
    private readonly processor: CashInProcessor,
    private readonly logger: LogsService,
  ) {}

  async execute(
    command: HandlePaymentNotificationCommand,
  ): Promise<PaymentNotificationResult> {
    const context = {
      traceId: command.traceId,
      operationId: command.operationId,
      notificationId: command.notificationId,
      type: command.type,
    };
    const operation = await this.operations.findById(command.operationId);
    if (!operation) {
      throw new CashInOperationNotFoundException(command.operationId);
    }
    try {
      operation.assertNotificationAmount(
        Money.of(command.amount, command.currency),
      );
    } catch (error) {
      this.logger.error(
        'Notification does not match the operation',
        error,
        context,
      );
      throw error;
    }

    try {
      const result = await this.apply(command);
      this.logger.info('Payment notification handled', { ...context, result });
      return { result };
    } catch (error) {
      if (error instanceof DuplicatePaymentNotificationException) {
        this.logger.info('Payment notification already handled', context);
        return { result: 'duplicate' };
      }
      throw error;
    }
  }

  private async apply(
    command: HandlePaymentNotificationCommand,
  ): Promise<TransitionResult> {
    const settlement = { traceId: command.traceId };
    const notification = {
      notificationId: command.notificationId,
      type: command.type,
    };
    switch (command.type) {
      case 'payment.succeeded':
        return (
          await this.processor.settleApproved(
            command.operationId,
            requiredField(command.providerChargeId, 'provider_charge_id'),
            { ...settlement, notification },
          )
        ).result;
      case 'payment.failed':
        return (
          await this.processor.settleDeclined(
            command.operationId,
            requiredField(command.failureReason, 'failure_reason'),
            { ...settlement, notification },
          )
        ).result;
      case 'payment.processing':
        await this.unitOfWork.commit(
          {
            notification: PaymentNotification.record({
              ...notification,
              operationId: command.operationId,
              result: 'ignored',
            }),
          },
          command.traceId,
        );
        return 'ignored';
    }
  }
}

function requiredField(value: string | null, name: string): string {
  if (value === null) {
    throw new DataInputException(
      `${name} is required for this notification type`,
    );
  }
  return value;
}
