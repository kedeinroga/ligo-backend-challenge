import { INestApplication } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { Db } from 'mongodb';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { setupApp } from '../src/app.setup.js';
import { ReconcilePendingOperationsCommand } from '../src/modules/cash-in/application/commands/reconcile-pending-operations/reconcile-pending-operations.command.js';
import { CashInOperation } from '../src/modules/cash-in/domain/cash-in-operation.aggregate.js';
import { CashInOperationRepository } from '../src/modules/cash-in/domain/cash-in-operation.repository.js';
import { Money } from '../src/shared/domain/index.js';
import { MONGO_DB } from '../src/shared/infrastructure/mongo/mongo.tokens.js';

describe('Reconciliation (e2e)', () => {
  let app: INestApplication;
  let db: Db;
  let operations: CashInOperationRepository;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = setupApp(moduleRef.createNestApplication({ rawBody: true }));
    await app.init();
    db = app.get<Db>(MONGO_DB, { strict: false });
    operations = app.get(CashInOperationRepository, { strict: false });
  });

  // The reconciler claims any stale pending operation: leftovers of other files
  // would fill its batch, so each test starts without any.
  beforeEach(async () => {
    await db.collection('cash_in_operations').deleteMany({ status: 'pending' });
  });

  afterAll(async () => {
    await app.close();
  });

  const reconcile = () =>
    app
      .get(CommandBus)
      .execute(new ReconcilePendingOperationsCommand('trace-e2e'));

  async function seedWallet(userId: string): Promise<void> {
    const now = new Date();
    await db.collection('wallets').insertOne({
      _id: userId,
      currency: 'PEN',
      balanceMinor: 25000n,
      version: 0,
      createdAt: now,
      updatedAt: now,
    } as never);
  }

  async function balanceMinorOf(userId: string): Promise<bigint> {
    const wallet = await db
      .collection<{ _id: string; balanceMinor: bigint }>('wallets')
      .findOne({ _id: userId });
    return wallet?.balanceMinor ?? 0n;
  }

  const chargeOf = (operationId: string) =>
    db
      .collection<{ _id: string; calls: number }>('simulated_provider_charges')
      .findOne({ _id: operationId });

  async function submissionsOf(operationId: string): Promise<number> {
    const stored = await db
      .collection<{ _id: string; providerCallCount: number }>(
        'cash_in_operations',
      )
      .findOne({ _id: operationId });
    return stored?.providerCallCount ?? 0;
  }

  function cashIn(
    userId: string,
    paymentMethod: string,
    key = randomUUID(),
  ): request.Test {
    return request(app.getHttpServer())
      .post('/cash-in')
      .set('Idempotency-Key', key)
      .send({
        user_id: userId,
        amount: 100,
        currency: 'PEN',
        payment_method: paymentMethod,
      });
  }

  /** A pending operation the process never got to charge: inserted with the given lease. */
  async function abandonedOperation(
    userId: string,
    leaseMs: number,
  ): Promise<string> {
    const operation = CashInOperation.initiate({
      id: `op_${randomUUID()}`,
      userId,
      idempotencyKey: randomUUID(),
      amount: Money.of('100', 'PEN'),
      paymentMethod: 'card_xyz',
    });
    await operations.insertClaimed(operation, leaseMs);
    return operation.id;
  }

  it('reconciler completes a timed out operation', async () => {
    const userId = `usr_e2e_${randomUUID()}`;
    await seedWallet(userId);
    const first = await cashIn(userId, 'card_timeout').expect(202);

    const result = await reconcile();

    expect(result.claimed).toBe(1);
    expect(result.completed).toBe(1);
    expect((await operations.findById(first.body.operation_id))?.status).toBe(
      'completed',
    );
    expect(await balanceMinorOf(userId)).toBe(35000n);
    const charge = await chargeOf(first.body.operation_id);
    expect(charge?.calls).toBe(2);
  });

  it('reconciler completes an operation whose process died before calling the provider', async () => {
    const userId = `usr_e2e_${randomUUID()}`;
    await seedWallet(userId);
    // An already expired lease: the process that inserted it is gone.
    const operationId = await abandonedOperation(userId, -1_000);

    const result = await reconcile();

    expect(result).toMatchObject({ claimed: 1, completed: 1 });
    expect((await operations.findById(operationId))?.status).toBe('completed');
    expect(await balanceMinorOf(userId)).toBe(35000n);
    const charge = await chargeOf(operationId);
    expect(charge?.calls).toBe(1);
  });

  it('does not touch an operation whose lease is still held', async () => {
    const userId = `usr_e2e_${randomUUID()}`;
    await seedWallet(userId);
    const operationId = await abandonedOperation(userId, 60_000);

    const result = await reconcile();

    expect(result.claimed).toBe(0);
    expect((await operations.findById(operationId))?.status).toBe('pending');
    expect(await balanceMinorOf(userId)).toBe(25000n);
  });

  it('submits an operation whose outcome stays unknown once per run', async () => {
    const userId = `usr_e2e_${randomUUID()}`;
    await seedWallet(userId);
    const first = await cashIn(userId, 'card_unavailable').expect(202);
    const operationId = first.body.operation_id as string;
    const before = await submissionsOf(operationId);

    const result = await reconcile();

    expect(result).toMatchObject({ claimed: 1, completed: 0, stillPending: 1 });
    expect(await submissionsOf(operationId)).toBe(before + 1);
    expect((await operations.findById(operationId))?.status).toBe('pending');
  });

  it('lets two concurrent runs share the work without processing an operation twice', async () => {
    const userId = `usr_e2e_${randomUUID()}`;
    await seedWallet(userId);
    const ids = await Promise.all(
      Array.from({ length: 4 }, () => abandonedOperation(userId, -1_000)),
    );

    const [a, b] = await Promise.all([reconcile(), reconcile()]);

    expect(a.claimed + b.claimed).toBe(4);
    for (const id of ids) {
      const charge = await chargeOf(id);
      expect(charge?.calls).toBe(1);
    }
    expect(await balanceMinorOf(userId)).toBe(25000n + 4n * 10000n);
    expect(
      await db.collection('ledger_entries').countDocuments({ userId }),
    ).toBe(4);
  });
});
