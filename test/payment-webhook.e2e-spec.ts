import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHmac, randomUUID } from 'node:crypto';
import { Db } from 'mongodb';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { setupApp } from '../src/app.setup.js';
import { CashInOperation } from '../src/modules/cash-in/domain/cash-in-operation.aggregate.js';
import { CashInOperationRepository } from '../src/modules/cash-in/domain/cash-in-operation.repository.js';
import { DEFAULT_WEBHOOK_SIGNING_SECRET } from '../src/config/env.validation.js';
import { Money } from '../src/shared/domain/index.js';
import { MONGO_DB } from '../src/shared/infrastructure/mongo/mongo.tokens.js';

const SECRET = DEFAULT_WEBHOOK_SIGNING_SECRET;

function signatureOf(
  body: string,
  timestamp = Math.floor(Date.now() / 1000),
  secret = SECRET,
): string {
  const v1 = createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');
  return `t=${timestamp},v1=${v1}`;
}

describe('Payment webhook (e2e)', () => {
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

  afterAll(async () => {
    await app.close();
  });

  /** A pending operation of a user whose wallet holds 250.00 PEN, as if its charge outcome were unknown. */
  async function pendingOperation(): Promise<{
    userId: string;
    operationId: string;
  }> {
    const userId = `usr_e2e_${randomUUID()}`;
    const now = new Date();
    await db.collection('wallets').insertOne({
      _id: userId,
      currency: 'PEN',
      balanceMinor: 25000n,
      version: 0,
      createdAt: now,
      updatedAt: now,
    } as never);
    const operation = CashInOperation.initiate({
      id: `op_${randomUUID()}`,
      userId,
      idempotencyKey: randomUUID(),
      amount: Money.of('100', 'PEN'),
      paymentMethod: 'card_xyz',
    });
    await operations.insertClaimed(operation, 60_000);
    await operations.releaseLease(operation.id);
    return { userId, operationId: operation.id };
  }

  function notify(
    payload: Record<string, unknown>,
    options: { signature?: string | null } = {},
  ): request.Test {
    const body = JSON.stringify(payload);
    const call = request(app.getHttpServer())
      .post('/webhooks/payment')
      .set('Content-Type', 'application/json');
    const signature =
      options.signature === undefined ? signatureOf(body) : options.signature;
    if (signature !== null) {
      call.set('x-provider-signature', signature);
    }
    return call.send(body);
  }

  const succeeded = (
    operationId: string,
    eventId = `evt_${randomUUID()}`,
  ): Record<string, unknown> => ({
    event_id: eventId,
    type: 'payment.succeeded',
    operation_id: operationId,
    provider_charge_id: 'ch_webhook',
    amount: 100,
    currency: 'PEN',
  });

  const failed = (
    operationId: string,
    eventId = `evt_${randomUUID()}`,
  ): Record<string, unknown> => ({
    event_id: eventId,
    type: 'payment.failed',
    operation_id: operationId,
    amount: 100,
    currency: 'PEN',
    failure_reason: 'insufficient_funds',
  });

  async function balanceMinorOf(userId: string): Promise<bigint> {
    const wallet = await db
      .collection<{ _id: string; balanceMinor: bigint }>('wallets')
      .findOne({ _id: userId });
    return wallet?.balanceMinor ?? 0n;
  }

  const ledgerEntriesOf = (userId: string): Promise<number> =>
    db.collection('ledger_entries').countDocuments({ userId });

  it('completes a pending operation from a signed notification', async () => {
    const { userId, operationId } = await pendingOperation();

    const res = await notify(succeeded(operationId)).expect(200);

    expect(res.body).toEqual({ result: 'applied' });
    expect((await operations.findById(operationId))?.status).toBe('completed');
    expect(await balanceMinorOf(userId)).toBe(35000n);
  });

  it('credits once when the same notification arrives twice', async () => {
    const { userId, operationId } = await pendingOperation();
    const payload = succeeded(operationId, 'evt_twice_' + randomUUID());

    const first = await notify(payload).expect(200);
    const second = await notify(payload).expect(200);

    expect(first.body).toEqual({ result: 'applied' });
    expect(second.body).toEqual({ result: 'duplicate' });
    expect(await ledgerEntriesOf(userId)).toBe(1);
    expect(await balanceMinorOf(userId)).toBe(35000n);
  });

  it('credits once when the same notification arrives 5 times in parallel', async () => {
    const { userId, operationId } = await pendingOperation();
    const payload = succeeded(operationId, 'evt_parallel_' + randomUUID());

    const responses = await Promise.all(
      Array.from({ length: 5 }, () => notify(payload)),
    );

    const results = responses.map((res) => res.body.result as string);
    expect(results.filter((result) => result === 'applied')).toHaveLength(1);
    expect(results.filter((result) => result === 'duplicate')).toHaveLength(4);
    expect(await ledgerEntriesOf(userId)).toBe(1);
    expect(await balanceMinorOf(userId)).toBe(35000n);
  });

  it('keeps a completed operation when a failed notification arrives late', async () => {
    const { userId, operationId } = await pendingOperation();
    await notify(succeeded(operationId)).expect(200);

    const late = await notify(failed(operationId)).expect(200);

    expect(late.body).toEqual({ result: 'conflict' });
    expect((await operations.findById(operationId))?.status).toBe('completed');
    expect(await balanceMinorOf(userId)).toBe(35000n);
  });

  it('keeps a pending operation on a processing notification', async () => {
    const { operationId } = await pendingOperation();

    const res = await notify({
      event_id: `evt_${randomUUID()}`,
      type: 'payment.processing',
      operation_id: operationId,
      amount: 100,
      currency: 'PEN',
    }).expect(200);

    expect(res.body).toEqual({ result: 'ignored' });
    expect((await operations.findById(operationId))?.status).toBe('pending');
  });

  it('credits once when the webhook arrives while the provider call is in flight', async () => {
    const userId = `usr_e2e_${randomUUID()}`;
    const key = randomUUID();
    const now = new Date();
    await db.collection('wallets').insertOne({
      _id: userId,
      currency: 'PEN',
      balanceMinor: 25000n,
      version: 0,
      createdAt: now,
      updatedAt: now,
    } as never);
    const cashIn = request(app.getHttpServer())
      .post('/cash-in')
      .set('Idempotency-Key', key)
      .send({
        user_id: userId,
        amount: 100,
        currency: 'PEN',
        payment_method: 'card_slow',
      })
      .then((res) => res);

    // The operation is persisted before the provider is called: wait for it, then notify.
    let operationId: string | undefined;
    while (!operationId) {
      const stored = await db
        .collection('cash_in_operations')
        .findOne({ userId, idempotencyKey: key });
      operationId = stored?._id as unknown as string | undefined;
      if (!operationId) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    const webhook = await notify(succeeded(operationId)).expect(200);
    const response = await cashIn;

    expect(webhook.body).toEqual({ result: 'applied' });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      operation_id: operationId,
      status: 'completed',
      new_balance: 350,
    });
    expect(await ledgerEntriesOf(userId)).toBe(1);
    expect(await balanceMinorOf(userId)).toBe(35000n);
  });

  it('rejects an unsigned notification', async () => {
    const { operationId } = await pendingOperation();

    const res = await notify(succeeded(operationId), {
      signature: null,
    }).expect(401);

    expect(res.body.code).toBe('invalid-webhook-signature-exception');
    expect((await operations.findById(operationId))?.status).toBe('pending');
  });

  it.each([
    [
      'a wrong secret',
      (body: string) => signatureOf(body, undefined, 'another-secret-entirely'),
    ],
    [
      'an old timestamp',
      (body: string) => signatureOf(body, Math.floor(Date.now() / 1000) - 3600),
    ],
    ['a malformed header', () => 'garbage'],
  ])('rejects a notification signed with %s', async (_label, sign) => {
    const { operationId } = await pendingOperation();
    const payload = succeeded(operationId);

    const res = await notify(payload, {
      signature: sign(JSON.stringify(payload)),
    }).expect(401);

    expect(res.body.code).toBe('invalid-webhook-signature-exception');
    expect((await operations.findById(operationId))?.status).toBe('pending');
  });

  it('rejects a signature that covers a different body', async () => {
    const { operationId } = await pendingOperation();
    const signedBody = JSON.stringify(succeeded(operationId, 'evt_signed'));

    const res = await request(app.getHttpServer())
      .post('/webhooks/payment')
      .set('Content-Type', 'application/json')
      .set('x-provider-signature', signatureOf(signedBody))
      .send(JSON.stringify(succeeded(operationId, 'evt_tampered')))
      .expect(401);

    expect(res.body.code).toBe('invalid-webhook-signature-exception');
  });

  it('answers 404 for an unknown operation', async () => {
    const res = await notify(succeeded(`op_${randomUUID()}`)).expect(404);

    expect(res.body.code).toBe('cash-in-operation-not-found-exception');
  });

  it('rejects an amount mismatch and does not record the notification', async () => {
    const { userId, operationId } = await pendingOperation();
    const eventId = `evt_${randomUUID()}`;

    const mismatch = await notify({
      ...succeeded(operationId, eventId),
      amount: 99,
    }).expect(422);
    const retry = await notify(succeeded(operationId, eventId)).expect(200);

    expect(mismatch.body.code).toBe('payment-notification-mismatch-exception');
    expect(retry.body).toEqual({ result: 'applied' });
    expect(await balanceMinorOf(userId)).toBe(35000n);
  });

  it('rejects a signed payload with unknown fields', async () => {
    const { operationId } = await pendingOperation();

    const res = await notify({
      ...succeeded(operationId),
      surprise: true,
    }).expect(400);

    expect(res.body.code).toBe('data-input-exception');
  });
});
