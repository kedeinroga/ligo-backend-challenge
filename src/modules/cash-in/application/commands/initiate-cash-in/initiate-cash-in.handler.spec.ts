import { NoopLogsService } from '../../../../../shared/infrastructure/in-memory/noop-logs.service.js';
import {
  DataSourceException,
  Money,
} from '../../../../../shared/domain/index.js';
import {
  IdempotencyKeyReusedException,
  CashInOperationConcurrentlyModifiedException,
} from '../../../domain/cash-in-operation.exceptions.js';
import { Wallet } from '../../../domain/wallet.aggregate.js';
import { WalletCurrencyMismatchException } from '../../../domain/wallet.exceptions.js';
import { FakePaymentProvider } from '../../../infrastructure/in-memory/fake-payment-provider.js';
import { InMemoryCashInOperationRepository } from '../../../infrastructure/in-memory/in-memory-cash-in-operation.repository.js';
import { InMemoryCashInUnitOfWork } from '../../../infrastructure/in-memory/in-memory-cash-in.unit-of-work.js';
import { InMemoryWalletRepository } from '../../../infrastructure/in-memory/in-memory-wallet.repository.js';
import { CashInProcessor } from '../../cash-in-processor.js';
import { CashInSettings } from '../../cash-in.settings.js';
import { InitiateCashInCommand } from './initiate-cash-in.command.js';
import { InitiateCashInHandler } from './initiate-cash-in.handler.js';

const USER = 'usr_abc123';
const KEY = '7b1f1c1e-0000-4000-8000-000000000001';

function command(
  overrides: Partial<{
    key: string;
    amount: string;
    currency: string;
    paymentMethod: string;
  }> = {},
): InitiateCashInCommand {
  return new InitiateCashInCommand(
    USER,
    overrides.key ?? KEY,
    overrides.amount ?? '100',
    overrides.currency ?? 'PEN',
    overrides.paymentMethod ?? 'card_xyz',
    'trace-1',
  );
}

function setup(): {
  handler: InitiateCashInHandler;
  processor: CashInProcessor;
  operations: InMemoryCashInOperationRepository;
  wallets: InMemoryWalletRepository;
  unitOfWork: InMemoryCashInUnitOfWork;
  provider: FakePaymentProvider;
  seedWallet: (balance: string) => Promise<void>;
} {
  const operations = new InMemoryCashInOperationRepository();
  const wallets = new InMemoryWalletRepository();
  const unitOfWork = new InMemoryCashInUnitOfWork(operations, wallets);
  const provider = new FakePaymentProvider();
  const logger = new NoopLogsService();
  const settings = new CashInSettings(
    60_000,
    {
      maxAttempts: 3,
      baseDelayMs: 0,
      maxDelayMs: 0,
    },
    { minAgeMs: 0, batchSize: 20, maxProviderCalls: 10 },
  );
  const processor = new CashInProcessor(
    operations,
    wallets,
    unitOfWork,
    provider,
    settings,
    logger,
  );
  return {
    handler: new InitiateCashInHandler(
      operations,
      wallets,
      processor,
      settings,
      logger,
    ),
    processor,
    operations,
    wallets,
    unitOfWork,
    provider,
    seedWallet: async (balance) => {
      await wallets.insertIfAbsent(
        Wallet.rehydrate({
          userId: USER,
          balance: Money.of(balance, 'PEN'),
          createdAt: new Date(),
          updatedAt: new Date(),
          version: 0,
        }),
      );
    },
  };
}

describe(InitiateCashInHandler.name, () => {
  it('completes a new cash-in and calls the provider once with the operation id', async () => {
    const { handler, provider, seedWallet } = setup();
    await seedWallet('250');

    const result = await handler.execute(command());

    expect(result.status).toBe('completed');
    expect(result.newBalance?.toDecimalString()).toBe('350.00');
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].operationId).toBe(result.operationId);
  });

  it('auto creates the wallet on the first cash-in of a user', async () => {
    const { handler, wallets } = setup();

    const result = await handler.execute(command({ amount: '10.05' }));

    expect(result.newBalance?.toDecimalString()).toBe('10.05');
    expect((await wallets.findByUserId(USER))?.balance.currency).toBe('PEN');
  });

  it('rejects a currency mismatch before inserting or charging', async () => {
    const { handler, provider, operations, seedWallet } = setup();
    await seedWallet('250');

    await expect(
      handler.execute(command({ currency: 'USD' })),
    ).rejects.toBeInstanceOf(WalletCurrencyMismatchException);

    expect(provider.calls).toHaveLength(0);
    expect(await operations.findByIdempotencyKey(USER, KEY)).toBeNull();
  });

  it('replays a completed operation without calling the provider', async () => {
    const { handler, provider, unitOfWork, seedWallet } = setup();
    await seedWallet('250');
    const first = await handler.execute(command());

    const replay = await handler.execute(command());

    expect(replay).toEqual(first);
    expect(provider.calls).toHaveLength(1);
    expect(unitOfWork.ledgerEntries.size).toBe(1);
  });

  it('replays a failed operation', async () => {
    const { handler, provider } = setup();
    provider.script({ kind: 'declined', reason: 'insufficient_funds' });
    const first = await handler.execute(command());

    const replay = await handler.execute(command());

    expect(first.status).toBe('failed');
    expect(first.failureReason).toBe('insufficient_funds');
    expect(first.newBalance).toBeNull();
    expect(replay).toEqual(first);
    expect(provider.calls).toHaveLength(1);
  });

  it('rejects a reused key with a different amount', async () => {
    const { handler } = setup();
    await handler.execute(command());

    await expect(
      handler.execute(command({ amount: '50' })),
    ).rejects.toBeInstanceOf(IdempotencyKeyReusedException);
  });

  it('answers pending without calling the provider when the key is in flight', async () => {
    const { handler, provider } = setup();
    let concurrent: Promise<unknown> | undefined;
    provider.onCharge = async () => {
      // A duplicate request arrives while the first one is calling the provider.
      provider.onCharge = null;
      concurrent = handler.execute(command());
      await concurrent;
    };

    const first = await handler.execute(command());
    const duplicate = (await concurrent) as Awaited<
      ReturnType<InitiateCashInHandler['execute']>
    >;

    expect(duplicate.status).toBe('pending');
    expect(duplicate.operationId).toBe(first.operationId);
    expect(provider.calls).toHaveLength(1);
    expect(first.status).toBe('completed');
  });

  it('leaves the operation pending and releases the lease when the outcome is unknown', async () => {
    const { handler, provider, operations } = setup();
    provider.script({ kind: 'unknown', cause: 'timeout' });

    const result = await handler.execute(command());

    expect(result.status).toBe('pending');
    expect(result.newBalance).toBeNull();
    expect((await operations.claim(result.operationId, 1_000))?.status).toBe(
      'pending',
    );
  });

  it('re-submits a pending operation with the same operation id when the lease is free', async () => {
    const { handler, provider, unitOfWork } = setup();
    provider.script({ kind: 'unknown', cause: 'timeout' });
    const pending = await handler.execute(command());

    const retried = await handler.execute(command());

    expect(retried.status).toBe('completed');
    expect(retried.operationId).toBe(pending.operationId);
    expect(provider.calls.map((call) => call.operationId)).toEqual([
      pending.operationId,
      pending.operationId,
    ]);
    expect(unitOfWork.ledgerEntries.size).toBe(1);
  });

  it('takes the replay path when the insert hits the unique index', async () => {
    const { handler, provider, operations } = setup();
    const first = await handler.execute(command());
    // This request read before the winner inserted: it misses the lookup, then loses the insert.
    vi.spyOn(operations, 'findByIdempotencyKey').mockResolvedValueOnce(null);

    const loser = await handler.execute(command());

    expect(loser).toEqual(first);
    expect(provider.calls).toHaveLength(1);
  });

  it('fails the operation when the provider declines', async () => {
    const { handler, provider, wallets, seedWallet } = setup();
    await seedWallet('250');
    provider.script({ kind: 'declined', reason: 'insufficient_funds' });

    const result = await handler.execute(command());

    expect(result.status).toBe('failed');
    expect((await wallets.findByUserId(USER))?.balance.toDecimalString()).toBe(
      '250.00',
    );
  });

  it('propagates a data source failure before calling the provider', async () => {
    const { handler, provider, operations } = setup();
    vi.spyOn(operations, 'insertClaimed').mockRejectedValue(
      new DataSourceException('mongo down'),
    );

    await expect(handler.execute(command())).rejects.toBeInstanceOf(
      DataSourceException,
    );
    expect(provider.calls).toHaveLength(0);
  });

  it('answers pending when settlement cannot be persisted after an approval', async () => {
    const { handler, provider, unitOfWork, operations } = setup();
    unitOfWork.failNextCommitWith(new DataSourceException('mongo down'));

    const result = await handler.execute(command());

    expect(result.status).toBe('pending');
    expect(provider.calls).toHaveLength(1);
    expect((await operations.findById(result.operationId))?.status).toBe(
      'pending',
    );
  });

  it('credits once when the notification settles before the provider answers', async () => {
    const { handler, processor, provider, unitOfWork, seedWallet } = setup();
    await seedWallet('250');
    provider.onCharge = async (request) => {
      await processor.settleApproved(request.operationId, 'ch_webhook', {
        traceId: 'trace-webhook',
        notification: { notificationId: 'evt_1', type: 'payment.succeeded' },
      });
    };

    const result = await handler.execute(command());

    expect(result.status).toBe('completed');
    expect(result.newBalance?.toDecimalString()).toBe('350.00');
    expect(unitOfWork.ledgerEntries.size).toBe(1);
  });

  it('answers pending when the settlement keeps losing the race', async () => {
    const { handler, unitOfWork } = setup();
    vi.spyOn(unitOfWork, 'commit').mockRejectedValue(
      new CashInOperationConcurrentlyModifiedException('op'),
    );

    const result = await handler.execute(command());

    expect(result.status).toBe('pending');
  });
});
