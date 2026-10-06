import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { CashInUnitOfWork } from '../src/modules/cash-in/application/ports/cash-in-unit-of-work.port.js';
import { CashInOperation } from '../src/modules/cash-in/domain/cash-in-operation.aggregate.js';
import {
  CashInOperationConcurrentlyModifiedException,
  DuplicateCashInOperationException,
  LedgerEntryAlreadyRecordedException,
} from '../src/modules/cash-in/domain/cash-in-operation.exceptions.js';
import { CashInOperationRepository } from '../src/modules/cash-in/domain/cash-in-operation.repository.js';
import { Wallet } from '../src/modules/cash-in/domain/wallet.aggregate.js';
import { WalletRepository } from '../src/modules/cash-in/domain/wallet.repository.js';
import { Money } from '../src/shared/domain/index.js';

const LEASE_MS = 60_000;
const pen = (amount: string): Money => Money.of(amount, 'PEN');

describe('Cash-in persistence (e2e)', () => {
  let app: INestApplication;
  let operations: CashInOperationRepository;
  let wallets: WalletRepository;
  let unitOfWork: CashInUnitOfWork;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    operations = app.get(CashInOperationRepository, { strict: false });
    wallets = app.get(WalletRepository, { strict: false });
    unitOfWork = app.get(CashInUnitOfWork, { strict: false });
  });

  afterAll(async () => {
    await app.close();
  });

  function newOperation(userId: string, key = randomUUID()): CashInOperation {
    return CashInOperation.initiate({
      id: `op_${randomUUID()}`,
      userId,
      idempotencyKey: key,
      amount: pen('100'),
      paymentMethod: 'card_xyz',
    });
  }

  async function seededUser(balance = '250'): Promise<{
    userId: string;
    wallet: Wallet;
  }> {
    const userId = `usr_e2e_${randomUUID()}`;
    await wallets.insertIfAbsent(Wallet.open(userId, 'PEN'));
    const wallet = (await wallets.findByUserId(userId)) as Wallet;
    const entry = wallet.credit(pen(balance), `seed_${userId}`);
    await unitOfWork.commit({ wallet, ledgerEntry: entry }, 'trace');
    return { userId, wallet: (await wallets.findByUserId(userId)) as Wallet };
  }

  it('rejects a second operation with the same user and key', async () => {
    const userId = `usr_e2e_${randomUUID()}`;
    const key = randomUUID();
    await operations.insertClaimed(newOperation(userId, key), LEASE_MS);

    await expect(
      operations.insertClaimed(newOperation(userId, key), LEASE_MS),
    ).rejects.toBeInstanceOf(DuplicateCashInOperationException);
  });

  it('accepts the same key for different users', async () => {
    const key = randomUUID();

    await operations.insertClaimed(
      newOperation(`usr_e2e_${randomUUID()}`, key),
      LEASE_MS,
    );
    await expect(
      operations.insertClaimed(
        newOperation(`usr_e2e_${randomUUID()}`, key),
        LEASE_MS,
      ),
    ).resolves.toBeUndefined();
  });

  it('grants the lease to exactly one of 5 parallel claims', async () => {
    const operation = newOperation(`usr_e2e_${randomUUID()}`);
    await operations.insertClaimed(operation, LEASE_MS);
    await operations.releaseLease(operation.id);

    const claims = await Promise.all(
      Array.from({ length: 5 }, () => operations.claim(operation.id, LEASE_MS)),
    );

    expect(claims.filter((claim) => claim !== null)).toHaveLength(1);
  });

  it('does not let a released lease free a final operation', async () => {
    const { userId, wallet } = await seededUser();
    const operation = newOperation(userId);
    await operations.insertClaimed(operation, LEASE_MS);
    const pending = (await operations.findById(
      operation.id,
    )) as CashInOperation;
    pending.markCompleted('ch_1', wallet);
    await unitOfWork.commit({ operation: pending, wallet }, 'trace');

    await operations.releaseLease(operation.id);

    expect(await operations.claim(operation.id, LEASE_MS)).toBeNull();
  });

  it('settles operation, wallet and ledger entry together', async () => {
    const { userId, wallet } = await seededUser('250');
    const operation = newOperation(userId);
    await operations.insertClaimed(operation, LEASE_MS);
    const pending = (await operations.findById(
      operation.id,
    )) as CashInOperation;
    const completion = pending.markCompleted('ch_1', wallet);

    await unitOfWork.commit(
      {
        operation: pending,
        wallet,
        ledgerEntry:
          completion.result === 'applied' ? completion.ledgerEntry : undefined,
      },
      'trace',
    );

    const stored = (await operations.findById(operation.id)) as CashInOperation;
    expect(stored.status).toBe('completed');
    expect(stored.version).toBe(1);
    expect(stored.balanceAfter?.toDecimalString()).toBe('350.00');
    const storedWallet = (await wallets.findByUserId(userId)) as Wallet;
    expect(storedWallet.balance.toDecimalString()).toBe('350.00');
  });

  it('rejects a stale version in the unit of work', async () => {
    const operation = newOperation(`usr_e2e_${randomUUID()}`);
    await operations.insertClaimed(operation, LEASE_MS);
    const first = (await operations.findById(operation.id)) as CashInOperation;
    const second = (await operations.findById(operation.id)) as CashInOperation;
    first.markFailed('insufficient_funds');
    second.markFailed('insufficient_funds');

    await unitOfWork.commit({ operation: first }, 'trace');

    await expect(
      unitOfWork.commit({ operation: second }, 'trace'),
    ).rejects.toBeInstanceOf(CashInOperationConcurrentlyModifiedException);
  });

  it('rejects a second ledger entry for the same operation', async () => {
    const wallet = Wallet.open(`usr_e2e_${randomUUID()}`, 'PEN');
    const entry = wallet.credit(pen('10'), `op_${randomUUID()}`);
    await unitOfWork.commit({ ledgerEntry: entry }, 'trace');

    await expect(
      unitOfWork.commit({ ledgerEntry: entry }, 'trace'),
    ).rejects.toBeInstanceOf(LedgerEntryAlreadyRecordedException);
  });

  it('rolls back operation and wallet when the ledger entry already exists', async () => {
    const { userId, wallet } = await seededUser('250');
    const operation = newOperation(userId);
    await operations.insertClaimed(operation, LEASE_MS);
    const pending = (await operations.findById(
      operation.id,
    )) as CashInOperation;
    const completion = pending.markCompleted('ch_1', wallet);
    if (completion.result !== 'applied') {
      throw new Error('expected the completion to be applied');
    }
    await unitOfWork.commit({ ledgerEntry: completion.ledgerEntry }, 'trace');

    await expect(
      unitOfWork.commit(
        { operation: pending, wallet, ledgerEntry: completion.ledgerEntry },
        'trace',
      ),
    ).rejects.toBeInstanceOf(LedgerEntryAlreadyRecordedException);

    const stored = (await operations.findById(operation.id)) as CashInOperation;
    expect(stored.status).toBe('pending');
    const storedWallet = (await wallets.findByUserId(userId)) as Wallet;
    expect(storedWallet.balance.toDecimalString()).toBe('250.00');
  });
});
