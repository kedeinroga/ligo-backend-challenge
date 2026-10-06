import {
  DataInputException,
  Money,
} from '../../../../../shared/domain/index.js';
import { NoopLogsService } from '../../../../../shared/infrastructure/in-memory/noop-logs.service.js';
import { CashInOperation } from '../../../domain/cash-in-operation.aggregate.js';
import { CashInOperationNotFoundException } from '../../../domain/cash-in-operation.exceptions.js';
import { PaymentNotificationType } from '../../../domain/payment-notification.js';
import { PaymentNotificationMismatchException } from '../../../domain/payment-notification.exceptions.js';
import { Wallet } from '../../../domain/wallet.aggregate.js';
import { FakePaymentProvider } from '../../../infrastructure/in-memory/fake-payment-provider.js';
import { InMemoryCashInOperationRepository } from '../../../infrastructure/in-memory/in-memory-cash-in-operation.repository.js';
import { InMemoryCashInUnitOfWork } from '../../../infrastructure/in-memory/in-memory-cash-in.unit-of-work.js';
import { InMemoryWalletRepository } from '../../../infrastructure/in-memory/in-memory-wallet.repository.js';
import { CashInProcessor } from '../../cash-in-processor.js';
import { CashInSettings } from '../../cash-in.settings.js';
import { HandlePaymentNotificationCommand } from './handle-payment-notification.command.js';
import { HandlePaymentNotificationHandler } from './handle-payment-notification.handler.js';

const USER = 'usr_1';
const pen = (amount: string): Money => Money.of(amount, 'PEN');

function notification(
  type: PaymentNotificationType,
  overrides: Partial<{
    eventId: string;
    operationId: string;
    amount: string;
    providerChargeId: string | null;
    failureReason: string | null;
  }> = {},
): HandlePaymentNotificationCommand {
  return new HandlePaymentNotificationCommand(
    overrides.eventId ?? 'evt_1',
    type,
    overrides.operationId ?? 'op_1',
    overrides.providerChargeId === undefined
      ? type === 'payment.succeeded'
        ? 'ch_1'
        : null
      : overrides.providerChargeId,
    overrides.amount ?? '100',
    'PEN',
    overrides.failureReason === undefined
      ? type === 'payment.failed'
        ? 'insufficient_funds'
        : null
      : overrides.failureReason,
    'trace-1',
  );
}

async function setup(): Promise<{
  handler: HandlePaymentNotificationHandler;
  operations: InMemoryCashInOperationRepository;
  wallets: InMemoryWalletRepository;
  unitOfWork: InMemoryCashInUnitOfWork;
}> {
  const operations = new InMemoryCashInOperationRepository();
  const wallets = new InMemoryWalletRepository();
  const unitOfWork = new InMemoryCashInUnitOfWork(operations, wallets);
  const logger = new NoopLogsService();
  const processor = new CashInProcessor(
    operations,
    wallets,
    unitOfWork,
    new FakePaymentProvider(),
    new CashInSettings(
      1_000,
      {
        maxAttempts: 3,
        baseDelayMs: 0,
        maxDelayMs: 0,
      },
      { minAgeMs: 0, batchSize: 20, maxProviderCalls: 10 },
    ),
    logger,
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
  await operations.insertClaimed(
    CashInOperation.initiate({
      id: 'op_1',
      userId: USER,
      idempotencyKey: 'key-1',
      amount: pen('100'),
      paymentMethod: 'card_xyz',
    }),
    1_000,
  );
  return {
    handler: new HandlePaymentNotificationHandler(
      operations,
      unitOfWork,
      processor,
      logger,
    ),
    operations,
    wallets,
    unitOfWork,
  };
}

describe(HandlePaymentNotificationHandler.name, () => {
  it('completes and credits a pending operation on succeeded', async () => {
    const { handler, operations, wallets, unitOfWork } = await setup();

    const result = await handler.execute(notification('payment.succeeded'));

    expect(result).toEqual({ result: 'applied' });
    const operation = await operations.findById('op_1');
    expect(operation?.status).toBe('completed');
    expect(operation?.providerChargeId).toBe('ch_1');
    expect((await wallets.findByUserId(USER))?.balance.toDecimalString()).toBe(
      '350.00',
    );
    expect(unitOfWork.ledgerEntries.size).toBe(1);
    expect(unitOfWork.notifications.get('evt_1')?.result).toBe('applied');
  });

  it('fails a pending operation on failed', async () => {
    const { handler, operations, wallets } = await setup();

    const result = await handler.execute(notification('payment.failed'));

    expect(result).toEqual({ result: 'applied' });
    const operation = await operations.findById('op_1');
    expect(operation?.status).toBe('failed');
    expect(operation?.failureReason).toBe('insufficient_funds');
    expect((await wallets.findByUserId(USER))?.balance.toDecimalString()).toBe(
      '250.00',
    );
  });

  it('records processing as ignored and leaves the operation pending', async () => {
    const { handler, operations, unitOfWork } = await setup();

    const result = await handler.execute(notification('payment.processing'));

    expect(result).toEqual({ result: 'ignored' });
    expect(unitOfWork.notifications.get('evt_1')?.result).toBe('ignored');
    expect((await operations.findById('op_1'))?.status).toBe('pending');
  });

  it('answers duplicate for a repeated event id and credits once', async () => {
    const { handler, wallets, unitOfWork } = await setup();
    await handler.execute(notification('payment.succeeded'));

    const repeated = await handler.execute(notification('payment.succeeded'));

    expect(repeated).toEqual({ result: 'duplicate' });
    expect(unitOfWork.ledgerEntries.size).toBe(1);
    expect((await wallets.findByUserId(USER))?.balance.toDecimalString()).toBe(
      '350.00',
    );
  });

  it('ignores processing after completed', async () => {
    const { handler, operations } = await setup();
    await handler.execute(notification('payment.succeeded'));

    const late = await handler.execute(
      notification('payment.processing', { eventId: 'evt_2' }),
    );

    expect(late).toEqual({ result: 'ignored' });
    expect((await operations.findById('op_1'))?.status).toBe('completed');
  });

  it('reports conflict for failed after completed and keeps the operation completed', async () => {
    const { handler, operations, wallets } = await setup();
    await handler.execute(notification('payment.succeeded'));

    const late = await handler.execute(
      notification('payment.failed', { eventId: 'evt_2' }),
    );

    expect(late).toEqual({ result: 'conflict' });
    expect((await operations.findById('op_1'))?.status).toBe('completed');
    expect((await wallets.findByUserId(USER))?.balance.toDecimalString()).toBe(
      '350.00',
    );
  });

  it('reports conflict for succeeded after failed and does not credit', async () => {
    const { handler, operations, wallets, unitOfWork } = await setup();
    await handler.execute(notification('payment.failed'));

    const late = await handler.execute(
      notification('payment.succeeded', { eventId: 'evt_2' }),
    );

    expect(late).toEqual({ result: 'conflict' });
    expect((await operations.findById('op_1'))?.status).toBe('failed');
    expect(unitOfWork.ledgerEntries.size).toBe(0);
    expect((await wallets.findByUserId(USER))?.balance.toDecimalString()).toBe(
      '250.00',
    );
  });

  it('throws not found for an unknown operation', async () => {
    const { handler, unitOfWork } = await setup();

    await expect(
      handler.execute(
        notification('payment.succeeded', { operationId: 'op_x' }),
      ),
    ).rejects.toBeInstanceOf(CashInOperationNotFoundException);
    expect(unitOfWork.notifications.size).toBe(0);
  });

  it('rejects an amount mismatch without recording it', async () => {
    const { handler, operations, unitOfWork } = await setup();

    await expect(
      handler.execute(notification('payment.succeeded', { amount: '99' })),
    ).rejects.toBeInstanceOf(PaymentNotificationMismatchException);

    expect(unitOfWork.notifications.size).toBe(0);
    expect((await operations.findById('op_1'))?.status).toBe('pending');
  });

  it('rejects a succeeded notification without a provider charge id', async () => {
    const { handler } = await setup();

    await expect(
      handler.execute(
        notification('payment.succeeded', { providerChargeId: null }),
      ),
    ).rejects.toBeInstanceOf(DataInputException);
  });
});
