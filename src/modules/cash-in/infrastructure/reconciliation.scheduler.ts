import {
  Injectable,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { randomUUID } from 'node:crypto';
import { AppConfigService } from '../../../config/app-config.service.js';
import { LogsService } from '../../../shared/application/ports/logs.service.js';
import { ReconcilePendingOperationsCommand } from '../application/commands/reconcile-pending-operations/reconcile-pending-operations.command.js';

/**
 * Runs the reconciliation periodically in every pod. Exclusivity does not come
 * from here (the `running` flag only avoids overlapping runs of one pod): each
 * operation is claimed atomically in Mongo, so pods never process the same one.
 */
@Injectable()
export class ReconciliationScheduler
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly commandBus: CommandBus,
    private readonly config: AppConfigService,
    private readonly logger: LogsService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.reconcilerEnabled) {
      return;
    }
    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.config.reconcilerIntervalMs);
    // The timer alone must not keep the process alive.
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  private async runOnce(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    const traceId = randomUUID();
    try {
      await this.commandBus.execute(
        new ReconcilePendingOperationsCommand(traceId),
      );
    } catch (error) {
      this.logger.error('Reconciliation run failed', error, { traceId });
    } finally {
      this.running = false;
    }
  }
}
