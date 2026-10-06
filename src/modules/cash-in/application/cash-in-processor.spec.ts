import { NoopLogsService } from '../../../shared/infrastructure/in-memory/noop-logs.service.js';
import { DataSourceException, Money } from '../../../shared/domain/index.js';
import { CashInOperation } from '../domain/cash-in-operation.aggregate.js';
import { LedgerEntryAlreadyRecordedException } from '../domain/cash-in-operation.exceptions.js';
import { Wallet } from '../domain/wallet.aggregate.js';
import { WalletConcurrentlyModifiedException } from '../domain/wallet.exceptions.js';
import { FakePaymentProvider } from '../infrastructure/in-memory/fake-payment-provider.js';
import { InMemoryCashInOperationRepository } from '../infrastructure/in-memory/in-memory-cash-in-operation.repository.js';
import { InMemoryCashInUnitOfWork } from '../infrastructure/in-memory/in-memory-cash-in.unit-of-work.js';
import { InMemoryWalletRepository } from '../infrastructure/in-memory/in-memory-wallet.repository.js';
import { CashInProcessor } from './cash-in-processor.js';
import { CashInSettings } from './cash-in.settings.js';

const MAX_ATTEMPTS = 3;
const USER = 'usr_1';
const pen = (amount: string): Money => Money.of(amount, 'PEN');

async function setup(): Promise<{
  processor: CashInProcessor;
  operations: InMemoryCashInOperationRepository;
  wallets: InMemoryWalletRepository;
  unitOfWork: InMemoryCashInUnitOfWork;
  provider: FakePaymentProvider;
  operation: CashInOperation;
}> {
  const operations = new InMemoryCashInOperationRepository();
  const wallets = new InMemoryWalletRepository();
  const unitOfWork = new InMemoryCashInUnitOfWork(operations, wallets);
  const provider = new FakePaymentProvider();
  const settings = new CashInSettings(1_000, {
    maxAttempts: MAX_ATTEMPTS,
    baseDelayMs: 0,
    maxDelayMs: 0,
  });
  const processor = new CashInProcessor(
    operations,
    wallets,
    unitOfWork,
    provider,
    settings,
    new NoopLogsService(),
  );
  await wallets.insertIfAbsent(
    Wallet.rehydrate({
      userId: USER,
      balance: pen('250'),
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 0,
    }),
  );
  const operation = CashInOperation.initiate({
    id: 'op_1',
    userId: USER,
    idempotencyKey: 'key-1',
    amount: pen('100'),
    paymentMethod: 'card_xyz',
  });
  await operations.insertClaimed(operation, 1_000);
  return { processor, operations, wallets, unitOfWork, provider, operation };
}

describe(CashInProcessor.name, () => {
  it('retries settlement on a concurrent wallet update', async () => {
    const { processor, wallets, unitOfWork } = await setup();
    unitOfWork.failNextCommitWith(
      new WalletConcurrentlyModifiedException(USER),
    );

    const { result } = await processor.settleApproved('op_1', 'ch_1', {
      traceId: 'trace',
    });

    expect(result).toBe('applied');
    expect(unitOfWork.ledgerEntries.size).toBe(1);
    expect((await wallets.findByUserId(USER))?.balance.toDecimalString()).toBe(
      '350.00',
    );
  });

  it('gives up after the max settlement attempts and leaves the operation pending', async () => {
    const { processor, operations, unitOfWork } = await setup();
    const commit = vi
      .spyOn(unitOfWork, 'commit')
      .mockRejectedValue(new WalletConcurrentlyModifiedException(USER));

    await expect(
      processor.settleApproved('op_1', 'ch_1', { traceId: 'trace' }),
    ).rejects.toBeInstanceOf(WalletConcurrentlyModifiedException);

    expect(commit).toHaveBeenCalledTimes(MAX_ATTEMPTS);
    expect((await operations.findById('op_1'))?.status).toBe('pending');
  });

  it('never commits a wallet change on ignored or conflict', async () => {
    const { processor, wallets, unitOfWork } = await setup();
    await processor.settleApproved('op_1', 'ch_1', { traceId: 'trace' });
    const commit = vi.spyOn(unitOfWork, 'commit');

    const duplicate = await processor.settleApproved('op_1', 'ch_1', {
      traceId: 'trace',
    });
    const contradicting = await processor.settleDeclined(
      'op_1',
      'insufficient_funds',
      { traceId: 'trace' },
    );

    expect(duplicate.result).toBe('ignored');
    expect(contradicting.result).toBe('conflict');
    expect(commit).not.toHaveBeenCalled();
    expect(unitOfWork.ledgerEntries.size).toBe(1);
    expect((await wallets.findByUserId(USER))?.balance.toDecimalString()).toBe(
      '350.00',
    );
  });

  it('records the notification in the same commit as the settlement', async () => {
    const { processor, unitOfWork } = await setup();

    await processor.settleApproved('op_1', 'ch_1', {
      traceId: 'trace',
      notification: { notificationId: 'evt_1', type: 'payment.succeeded' },
    });

    expect(unitOfWork.notifications.get('evt_1')?.result).toBe('applied');
    expect(unitOfWork.ledgerEntries.size).toBe(1);
  });

  it('answers pending when releasing the lease fails after an unknown outcome', async () => {
    const { processor, operations, provider, operation } = await setup();
    provider.script({ kind: 'unknown', cause: 'timeout' });
    vi.spyOn(operations, 'releaseLease').mockRejectedValue(
      new DataSourceException('down'),
    );

    const settled = await processor.chargeAndSettle(operation, 'trace');

    expect(settled.status).toBe('pending');
  });

  it('answers pending and releases the lease when settlement throws a non retryable error after an approval', async () => {
    const { processor, operations, unitOfWork, operation } = await setup();
    unitOfWork.failNextCommitWith(
      new LedgerEntryAlreadyRecordedException('op_1'),
    );
    const release = vi.spyOn(operations, 'releaseLease');

    const settled = await processor.chargeAndSettle(operation, 'trace');

    expect(settled.status).toBe('pending');
    expect(release).toHaveBeenCalledWith('op_1');
    expect((await operations.findById('op_1'))?.status).toBe('pending');
  });
});
