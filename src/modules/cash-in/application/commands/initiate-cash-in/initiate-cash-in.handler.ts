import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { randomUUID } from 'node:crypto';
import { LogsService } from '../../../../../shared/application/ports/logs.service.js';
import { Money } from '../../../../../shared/domain/index.js';
import { CashInOperation } from '../../../domain/cash-in-operation.aggregate.js';
import { DuplicateCashInOperationException } from '../../../domain/cash-in-operation.exceptions.js';
import { CashInOperationRepository } from '../../../domain/cash-in-operation.repository.js';
import { Wallet } from '../../../domain/wallet.aggregate.js';
import { WalletRepository } from '../../../domain/wallet.repository.js';
import { CashInProcessor } from '../../cash-in-processor.js';
import { CashInResult, toCashInResult } from '../../cash-in.results.js';
import { CashInSettings } from '../../cash-in.settings.js';
import { InitiateCashInCommand } from './initiate-cash-in.command.js';

@CommandHandler(InitiateCashInCommand)
export class InitiateCashInHandler implements ICommandHandler<InitiateCashInCommand> {
  constructor(
    private readonly operations: CashInOperationRepository,
    private readonly wallets: WalletRepository,
    private readonly processor: CashInProcessor,
    private readonly settings: CashInSettings,
    private readonly logger: LogsService,
  ) {}

  async execute(command: InitiateCashInCommand): Promise<CashInResult> {
    const amount = Money.of(command.amount, command.currency);
    const existing = await this.operations.findByIdempotencyKey(
      command.userId,
      command.idempotencyKey,
    );
    if (existing) {
      return this.replay(existing, amount, command);
    }

    const wallet =
      (await this.wallets.findByUserId(command.userId)) ??
      (await this.wallets.insertIfAbsent(
        Wallet.open(command.userId, amount.currency),
      ));
    wallet.assertCanBeCredited(amount);

    const operation = CashInOperation.initiate({
      id: `op_${randomUUID()}`,
      userId: command.userId,
      idempotencyKey: command.idempotencyKey,
      amount,
      paymentMethod: command.paymentMethod,
    });
    try {
      await this.operations.insertClaimed(operation, this.settings.leaseMs);
    } catch (error) {
      return this.replayOnDuplicate(error, amount, command);
    }
    this.logger.info('Cash-in initiated', {
      traceId: command.traceId,
      operationId: operation.id,
      userId: operation.userId,
      amount: amount.toDecimalString(),
    });

    return toCashInResult(
      await this.processor.chargeAndSettle(operation, command.traceId),
    );
  }

  /** Another request inserted the same (user, key) first: this one becomes a replay. */
  private async replayOnDuplicate(
    error: unknown,
    amount: Money,
    command: InitiateCashInCommand,
  ): Promise<CashInResult> {
    if (!(error instanceof DuplicateCashInOperationException)) {
      throw error;
    }
    const winner = await this.operations.findByIdempotencyKey(
      command.userId,
      command.idempotencyKey,
    );
    if (!winner) {
      throw error;
    }
    return this.replay(winner, amount, command);
  }

  private async replay(
    existing: CashInOperation,
    amount: Money,
    command: InitiateCashInCommand,
  ): Promise<CashInResult> {
    existing.assertSameRequest(amount, command.paymentMethod);
    if (existing.isFinal()) {
      this.logger.info('Cash-in replayed', {
        traceId: command.traceId,
        operationId: existing.id,
        userId: existing.userId,
      });
      return toCashInResult(existing);
    }
    const claimed = await this.operations.claim(
      existing.id,
      this.settings.leaseMs,
    );
    if (!claimed) {
      // Another request holds the lease, or the operation became final after the
      // lookup: answer its current state without calling the provider.
      const current = await this.operations.findById(existing.id);
      return toCashInResult(current ?? existing);
    }
    return toCashInResult(
      await this.processor.chargeAndSettle(claimed, command.traceId),
    );
  }
}
