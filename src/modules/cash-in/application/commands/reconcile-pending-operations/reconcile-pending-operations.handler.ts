import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { LogsService } from '../../../../../shared/application/ports/logs.service.js';
import { CashInOperationRepository } from '../../../domain/cash-in-operation.repository.js';
import { CashInProcessor } from '../../cash-in-processor.js';
import { ReconciliationResult } from '../../cash-in.results.js';
import { CashInSettings } from '../../cash-in.settings.js';
import { ReconcilePendingOperationsCommand } from './reconcile-pending-operations.command.js';

/**
 * Resolves stale pending operations by re-submitting their charge with the same
 * provider key. Each operation is claimed atomically in Mongo, so several pods
 * running this at once never process the same one. Operations that already
 * reached the submission cap stay pending for manual review.
 */
@CommandHandler(ReconcilePendingOperationsCommand)
export class ReconcilePendingOperationsHandler implements ICommandHandler<ReconcilePendingOperationsCommand> {
  constructor(
    private readonly operations: CashInOperationRepository,
    private readonly processor: CashInProcessor,
    private readonly settings: CashInSettings,
    private readonly logger: LogsService,
  ) {}

  async execute({
    traceId,
  }: ReconcilePendingOperationsCommand): Promise<ReconciliationResult> {
    const { minAgeMs, batchSize, maxProviderCalls } =
      this.settings.reconciliation;
    const createdBefore = new Date(Date.now() - minAgeMs);
    const handled: string[] = [];
    let completed = 0;
    let failed = 0;
    let stillPending = 0;

    while (handled.length < batchSize) {
      const operation = await this.operations.claimNextStale(
        createdBefore,
        maxProviderCalls,
        this.settings.leaseMs,
        handled,
      );
      if (!operation) {
        break;
      }
      handled.push(operation.id);
      try {
        const settled = await this.processor.chargeAndSettle(
          operation,
          traceId,
        );
        if (settled.status === 'completed') {
          completed += 1;
        } else if (settled.status === 'failed') {
          failed += 1;
        } else {
          stillPending += 1;
        }
      } catch (error) {
        // One failing operation never stops the batch.
        stillPending += 1;
        this.logger.error('Reconciliation of an operation failed', error, {
          traceId,
          operationId: operation.id,
        });
      }
    }

    const result = { claimed: handled.length, completed, failed, stillPending };
    this.logger.info('Reconciliation finished', { traceId, ...result });
    return result;
  }
}
