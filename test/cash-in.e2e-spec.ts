import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { Db } from 'mongodb';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { setupApp } from '../src/app.setup.js';
import { MONGO_DB } from '../src/shared/infrastructure/mongo/mongo.tokens.js';

interface CashInBody {
  operation_id: string;
  status: string;
  amount: number;
  new_balance?: number;
  failure_reason?: string;
}

async function createApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = setupApp(moduleRef.createNestApplication({ rawBody: true }));
  await app.init();
  return app;
}

function newUser(): string {
  return `usr_e2e_${randomUUID()}`;
}

describe('Cash-in (e2e)', () => {
  let app: INestApplication;
  let secondPod: INestApplication;
  let db: Db;

  beforeAll(async () => {
    app = await createApp();
    secondPod = await createApp();
    db = app.get<Db>(MONGO_DB, { strict: false });
  });

  afterAll(async () => {
    await secondPod.close();
    await app.close();
  });

  function cashIn(
    userId: string,
    options: {
      key?: string | null;
      amount?: unknown;
      currency?: string;
      paymentMethod?: string;
      extra?: Record<string, unknown>;
      pod?: INestApplication;
    } = {},
  ): request.Test {
    const key = options.key === undefined ? randomUUID() : options.key;
    const call = request((options.pod ?? app).getHttpServer()).post('/cash-in');
    if (key !== null) {
      call.set('Idempotency-Key', key);
    }
    return call.send({
      user_id: userId,
      amount: options.amount ?? 100.0,
      currency: options.currency ?? 'PEN',
      payment_method: options.paymentMethod ?? 'card_xyz',
      ...options.extra,
    });
  }

  async function seedWallet(
    userId: string,
    balanceMinor: bigint,
  ): Promise<void> {
    const now = new Date();
    await db.collection<{ _id: string }>('wallets').insertOne({
      _id: userId,
      currency: 'PEN',
      balanceMinor,
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

  const ledgerEntriesOf = (userId: string): Promise<number> =>
    db.collection('ledger_entries').countDocuments({ userId });

  it('returns the statement contract for a completed cash-in', async () => {
    const userId = newUser();
    await seedWallet(userId, 25000n);

    const res = await cashIn(userId).expect(200);

    expect(res.body).toEqual({
      operation_id: expect.stringMatching(/^op_/),
      status: 'completed',
      amount: 100,
      new_balance: 350,
    });
  });

  it('returns the same body on a retry with the same key', async () => {
    const userId = newUser();
    await seedWallet(userId, 25000n);
    const key = randomUUID();

    const first = await cashIn(userId, { key }).expect(200);
    const retry = await cashIn(userId, { key }).expect(200);

    expect(retry.body).toEqual(first.body);
    expect(await balanceMinorOf(userId)).toBe(35000n);
    expect(await ledgerEntriesOf(userId)).toBe(1);
  });

  it('charges once when 5 requests share a key', async () => {
    const userId = newUser();
    await seedWallet(userId, 25000n);
    const key = randomUUID();

    const responses = await Promise.all(
      [app, secondPod, app, secondPod, app].map((pod) =>
        cashIn(userId, { key, paymentMethod: 'card_slow', pod }),
      ),
    );

    const bodies = responses.map((res) => res.body as CashInBody);
    expect(new Set(bodies.map((body) => body.operation_id)).size).toBe(1);
    expect(responses.some((res) => res.status === 202)).toBe(true);
    for (const res of responses) {
      expect([200, 202]).toContain(res.status);
    }
    const completed = bodies.filter((body) => body.status === 'completed');
    expect(completed.length).toBeGreaterThanOrEqual(1);
    expect(new Set(completed.map((body) => body.new_balance))).toEqual(
      new Set([350]),
    );
    const charge = await db
      .collection('simulated_provider_charges')
      .findOne({ _id: bodies[0].operation_id as never });
    expect(charge?.calls).toBe(1);
    expect(await ledgerEntriesOf(userId)).toBe(1);
    expect(await balanceMinorOf(userId)).toBe(35000n);
  });

  it('applies 5 concurrent cash-ins of one user exactly once each', async () => {
    const userId = newUser();
    await seedWallet(userId, 25000n);

    const responses = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        cashIn(userId, { pod: i % 2 === 0 ? app : secondPod }),
      ),
    );

    for (const res of responses) {
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('completed');
    }
    const balances = responses.map(
      (res) => (res.body as CashInBody).new_balance,
    );
    expect(new Set(balances).size).toBe(5);
    expect(await balanceMinorOf(userId)).toBe(75000n);
    expect(await ledgerEntriesOf(userId)).toBe(5);
  });

  it('completes a timed out charge on retry without charging twice', async () => {
    const userId = newUser();
    await seedWallet(userId, 25000n);
    const key = randomUUID();

    const first = await cashIn(userId, {
      key,
      paymentMethod: 'card_timeout',
    }).expect(202);
    const retry = await cashIn(userId, {
      key,
      paymentMethod: 'card_timeout',
    }).expect(200);

    expect(first.body).toEqual({
      operation_id: retry.body.operation_id,
      status: 'pending',
      amount: 100,
    });
    expect(retry.body.new_balance).toBe(350);
    const charge = await db
      .collection('simulated_provider_charges')
      .findOne({ _id: first.body.operation_id });
    expect(charge?.calls).toBe(2);
    expect(await ledgerEntriesOf(userId)).toBe(1);
    expect(await balanceMinorOf(userId)).toBe(35000n);
  });

  it('returns failed without new_balance when the provider declines', async () => {
    const userId = newUser();
    await seedWallet(userId, 25000n);

    const res = await cashIn(userId, { paymentMethod: 'card_declined' }).expect(
      200,
    );

    expect(res.body).toEqual({
      operation_id: expect.stringMatching(/^op_/),
      status: 'failed',
      amount: 100,
      failure_reason: 'insufficient_funds',
    });
    expect(await balanceMinorOf(userId)).toBe(25000n);
    expect(await ledgerEntriesOf(userId)).toBe(0);
  });

  it('answers pending after the provider stays unavailable', async () => {
    const userId = newUser();
    await seedWallet(userId, 25000n);

    const res = await cashIn(userId, {
      paymentMethod: 'card_unavailable',
    }).expect(202);

    expect(res.body.status).toBe('pending');
    expect(
      await db
        .collection('simulated_provider_charges')
        .countDocuments({ _id: res.body.operation_id }),
    ).toBe(0);
    expect(await balanceMinorOf(userId)).toBe(25000n);
  });

  it('rejects a reused key with another payload', async () => {
    const userId = newUser();
    const key = randomUUID();
    await cashIn(userId, { key }).expect(200);

    const res = await cashIn(userId, { key, amount: 50 }).expect(422);

    expect(res.body.code).toBe('idempotency-key-reused-exception');
  });

  it.each([
    ['missing', null],
    ['malformed', 'not-a-uuid'],
  ])('rejects a %s idempotency key', async (_label, key) => {
    const res = await cashIn(newUser(), { key }).expect(400);

    expect(res.body.code).toBe('invalid-idempotency-key-exception');
  });

  it.each([
    ['3 decimals', { amount: 10.123 }],
    ['a string amount', { amount: '100' }],
    ['a zero amount', { amount: 0 }],
    ['an unknown currency', { currency: 'EUR' }],
    ['unknown fields', { extra: { surprise: true } }],
  ])('rejects %s', async (_label, options) => {
    const res = await cashIn(newUser(), options).expect(400);

    expect(res.body.code).toBe('data-input-exception');
  });

  it('rejects a currency mismatch', async () => {
    const userId = newUser();
    await seedWallet(userId, 25000n);

    const res = await cashIn(userId, { currency: 'USD' }).expect(422);

    expect(res.body.code).toBe('wallet-currency-mismatch-exception');
    expect(await balanceMinorOf(userId)).toBe(25000n);
  });
});
