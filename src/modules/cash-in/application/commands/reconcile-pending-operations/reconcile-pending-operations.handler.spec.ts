import { Money } from '../../../../../shared/domain/index.js';
import { NoopLogsService } from '../../../../../shared/infrastructure/in-memory/noop-logs.service.js';
import { CashInOperation } from '../../../domain/cash-in-operation.aggregate.js';
import { Wallet } from '../../../domain/wallet.aggregate.js';
import { FakePaymentProvider } from '../../../infrastructure/in-memory/fake-payment-provider.js';
import { InMemoryCashInOperationRepository } from '../../../infrastructure/in-memory/in-memory-cash-in-operation.repository.js';
import { InMemoryCashInUnitOfWork } from '../../../infrastructure/in-memory/in-memory-cash-in.unit-of-work.js';
import { InMemoryWalletRepository } from '../../../infrastructure/in-memory/in-memory-wallet.repository.js';
import { CashInProcessor } from '../../cash-in-processor.js';
import { CashInSettings } from '../../cash-in.settings.js';
import { ReconcilePendingOperationsCommand } from './reconcile-pending-operations.command.js';
import { ReconcilePendingOperationsHandler } from './reconcile-pending-operations.handler.js';

const BATCH_SIZE = 3;
const pen = (amount: string): Money => Money.of(amount, 'PEN');

async function setup(): Promise<{
  handler: ReconcilePendingOperationsHandler;
  operations: InMemoryCashInOperationRepository;
  wallets: InMemoryWalletRepository;
  provider: FakePaymentProvider;
  stale: (id: string, options?: { leaseHeld?: boolean }) => Promise<void>;
}> {
  const operations = new InMemoryCashInOperationRepository();
  const wallets = new InMemoryWalletRepository();
  const unitOfWork = new InMemoryCashInUnitOfWork(operations, wallets);
  const provider = new FakePaymentProvider();
  const logger = new NoopLogsService();
  const settings = new CashInSettings(
    60_000,
    { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0 },
    { minAgeMs: 0, batchSize: BATCH_SIZE, maxProviderCalls: 10 },
  );
  const processor = new CashInProcessor(
    operations,
    wallets,
    unitOfWork,
    provider,
    settings,
    logger,
  );
  await wallets.insertIfAbsent(
    Wallet.rehydrate({
      userId: 'usr_1',
      balance: pen('250'),
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 0,
    }),
  );
  return {
    handler: new ReconcilePendingOperationsHandler(
      operations,
      processor,
      settings,
      logger,
    ),
    operations,
    wallets,
    provider,
    stale: async (id, options = {}) => {
      const old = new Date(Date.now() - 60_000);
      await operations.insertClaimed(
        CashInOperation.rehydrate({
          id,
          userId: 'usr_1',
          idempotencyKey: `key-${id}`,
          amount: pen('100'),
          paymentMethod: 'card_xyz',
          status: 'pending',
          providerChargeId: null,
          failureReason: null,
          balanceAfter: null,
          createdAt: old,
          updatedAt: old,
          version: 0,
        }),
        60_000,
      );
      if (!options.leaseHeld) {
        await operations.releaseLease(id);
      }
    },
  };
}

const run = (handler: ReconcilePendingOperationsHandler) =>
  handler.execute(new ReconcilePendingOperationsCommand('trace-1'));

describe(ReconcilePendingOperationsHandler.name, () => {
  it('completes a stale pending operation', async () => {
    const { handler, operations, wallets, provider, stale } = await setup();
    await stale('op_1');

    const result = await run(handler);

    expect(result).toEqual({
      claimed: 1,
      completed: 1,
      failed: 0,
      stillPending: 0,
    });
    expect((await operations.findById('op_1'))?.status).toBe('completed');
    expect(
      (await wallets.findByUserId('usr_1'))?.balance.toDecimalString(),
    ).toBe('350.00');
    expect(provider.calls.map((call) => call.operationId)).toEqual(['op_1']);
  });

  it('fails a stale operation the provider declined', async () => {
    const { handler, operations, provider, stale } = await setup();
    await stale('op_1');
    provider.script({ kind: 'declined', reason: 'insufficient_funds' });

    const result = await run(handler);

    expect(result.failed).toBe(1);
    expect((await operations.findById('op_1'))?.status).toBe('failed');
  });

  it('skips an operation whose lease is held', async () => {
    const { handler, operations, provider, stale } = await setup();
    await stale('op_1', { leaseHeld: true });

    const result = await run(handler);

    expect(result.claimed).toBe(0);
    expect(provider.calls).toHaveLength(0);
    expect((await operations.findById('op_1'))?.status).toBe('pending');
  });

  it('stops at the batch size', async () => {
    const { handler, operations, stale } = await setup();
    for (const id of ['op_1', 'op_2', 'op_3', 'op_4', 'op_5']) {
      await stale(id);
    }

    const result = await run(handler);

    expect(result.claimed).toBe(BATCH_SIZE);
    expect((await operations.findById('op_5'))?.status).toBe('pending');
  });

  it('keeps going after one operation throws', async () => {
    const { handler, operations, provider, stale } = await setup();
    await stale('op_1');
    await stale('op_2');
    let calls = 0;
    provider.onCharge = async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error('provider adapter blew up');
      }
    };

    const result = await run(handler);

    expect(result).toEqual({
      claimed: 2,
      completed: 1,
      failed: 0,
      stillPending: 1,
    });
    expect((await operations.findById('op_2'))?.status).toBe('completed');
  });

  it('leaves an operation pending when the outcome is still unknown and submits it once per run', async () => {
    const { handler, operations, provider, stale } = await setup();
    await stale('op_1');
    provider.script(
      { kind: 'unknown', cause: 'timeout' },
      { kind: 'unknown', cause: 'timeout' },
    );

    const result = await run(handler);

    expect(result).toEqual({
      claimed: 1,
      completed: 0,
      failed: 0,
      stillPending: 1,
    });
    expect(provider.calls).toHaveLength(1);
    expect((await operations.findById('op_1'))?.status).toBe('pending');
  });

  it('does not touch operations that reached the submission cap', async () => {
    const { handler, operations, provider, stale } = await setup();
    await stale('op_1');
    for (let i = 0; i < 9; i += 1) {
      await operations.claim('op_1', 1);
      await operations.releaseLease('op_1');
    }

    const result = await run(handler);

    expect(result.claimed).toBe(0);
    expect(provider.calls).toHaveLength(0);
  });
});
