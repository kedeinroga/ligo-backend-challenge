import { Money } from '../../../shared/domain/index.js';
import {
  IdempotencyKeyReusedException,
  InvalidCashInAmountException,
  InvalidPaymentMethodException,
} from './cash-in-operation.exceptions.js';
import { CashInOperation } from './cash-in-operation.aggregate.js';
import { PaymentNotificationMismatchException } from './payment-notification.exceptions.js';
import { Wallet } from './wallet.aggregate.js';

const pen = (amount: string): Money => Money.of(amount, 'PEN');

function initiate(
  overrides: { amount?: Money; paymentMethod?: string } = {},
): CashInOperation {
  return CashInOperation.initiate({
    id: 'op_1',
    userId: 'usr_1',
    idempotencyKey: 'key-1',
    amount: overrides.amount ?? pen('100'),
    paymentMethod: overrides.paymentMethod ?? 'card_xyz',
  });
}

function walletWith(balance: string): Wallet {
  return Wallet.rehydrate({
    userId: 'usr_1',
    balance: pen(balance),
    createdAt: new Date(),
    updatedAt: new Date(),
    version: 0,
  });
}

describe(CashInOperation.name, () => {
  describe('initiate', () => {
    it('starts pending at version 0 with no outcome data', () => {
      const operation = initiate();

      expect(operation.status).toBe('pending');
      expect(operation.version).toBe(0);
      expect(operation.providerChargeId).toBeNull();
      expect(operation.failureReason).toBeNull();
      expect(operation.balanceAfter).toBeNull();
      expect(operation.isFinal()).toBe(false);
    });

    it('rejects a zero or negative amount', () => {
      expect(() => initiate({ amount: pen('0') })).toThrow(
        InvalidCashInAmountException,
      );
      expect(() => initiate({ amount: pen('-1') })).toThrow(
        InvalidCashInAmountException,
      );
    });

    it('rejects an empty or 65 character payment method', () => {
      expect(() => initiate({ paymentMethod: '' })).toThrow(
        InvalidPaymentMethodException,
      );
      expect(() => initiate({ paymentMethod: 'x'.repeat(65) })).toThrow(
        InvalidPaymentMethodException,
      );
      expect(() => initiate({ paymentMethod: 'x'.repeat(64) })).not.toThrow();
    });
  });

  describe('assertSameRequest', () => {
    it('accepts a replay with the same amount, currency and payment method', () => {
      expect(() =>
        initiate().assertSameRequest(pen('100'), 'card_xyz'),
      ).not.toThrow();
    });

    it('rejects a reused key with a different amount', () => {
      expect(() => initiate().assertSameRequest(pen('50'), 'card_xyz')).toThrow(
        IdempotencyKeyReusedException,
      );
    });

    it('rejects a reused key with a different currency', () => {
      expect(() =>
        initiate().assertSameRequest(Money.of('100', 'USD'), 'card_xyz'),
      ).toThrow(IdempotencyKeyReusedException);
    });

    it('rejects a reused key with a different payment method', () => {
      expect(() =>
        initiate().assertSameRequest(pen('100'), 'card_other'),
      ).toThrow(IdempotencyKeyReusedException);
    });
  });

  describe('assertNotificationAmount', () => {
    it('rejects a notification with another amount or currency', () => {
      const operation = initiate();

      expect(() =>
        operation.assertNotificationAmount(pen('100')),
      ).not.toThrow();
      expect(() => operation.assertNotificationAmount(pen('99.99'))).toThrow(
        PaymentNotificationMismatchException,
      );
      expect(() =>
        operation.assertNotificationAmount(Money.of('100', 'USD')),
      ).toThrow(PaymentNotificationMismatchException);
    });
  });

  describe('markCompleted', () => {
    it('credits the wallet from pending, storing charge id and balance after', () => {
      const operation = initiate();
      const wallet = walletWith('250');

      const completion = operation.markCompleted('ch_1', wallet);

      expect(completion.result).toBe('applied');
      expect(operation.status).toBe('completed');
      expect(operation.providerChargeId).toBe('ch_1');
      expect(operation.balanceAfter?.toDecimalString()).toBe('350.00');
      expect(wallet.balance.toDecimalString()).toBe('350.00');
      if (completion.result === 'applied') {
        expect(completion.ledgerEntry.operationId).toBe('op_1');
      }
    });

    it('is ignored when already completed and leaves the wallet untouched', () => {
      const operation = initiate();
      operation.markCompleted('ch_1', walletWith('0'));
      const wallet = walletWith('350');

      expect(operation.markCompleted('ch_1', wallet).result).toBe('ignored');
      expect(wallet.balance.toDecimalString()).toBe('350.00');
      expect(operation.balanceAfter?.toDecimalString()).toBe('100.00');
    });

    it('reports a conflict when failed and leaves the wallet untouched', () => {
      const operation = initiate();
      operation.markFailed('insufficient_funds');
      const wallet = walletWith('250');

      expect(operation.markCompleted('ch_1', wallet).result).toBe('conflict');
      expect(wallet.balance.toDecimalString()).toBe('250.00');
      expect(operation.status).toBe('failed');
    });

    it('stays pending when the wallet rejects the credit', () => {
      const operation = initiate();
      const usdWallet = Wallet.open('usr_1', 'USD');

      expect(() => operation.markCompleted('ch_1', usdWallet)).toThrow();
      expect(operation.status).toBe('pending');
    });
  });

  describe('markFailed', () => {
    it('fails a pending operation storing the reason', () => {
      const operation = initiate();

      expect(operation.markFailed('insufficient_funds')).toBe('applied');
      expect(operation.status).toBe('failed');
      expect(operation.failureReason).toBe('insufficient_funds');
      expect(operation.isFinal()).toBe(true);
    });

    it('is ignored when already failed', () => {
      const operation = initiate();
      operation.markFailed('insufficient_funds');

      expect(operation.markFailed('other')).toBe('ignored');
      expect(operation.failureReason).toBe('insufficient_funds');
    });

    it('reports a conflict when already completed', () => {
      const operation = initiate();
      operation.markCompleted('ch_1', walletWith('0'));

      expect(operation.markFailed('insufficient_funds')).toBe('conflict');
      expect(operation.status).toBe('completed');
    });
  });

  it('rehydrates a stored operation without validating it', () => {
    const operation = CashInOperation.rehydrate({
      id: 'op_9',
      userId: 'usr_1',
      idempotencyKey: 'key-9',
      amount: pen('0'),
      paymentMethod: '',
      status: 'completed',
      providerChargeId: 'ch_9',
      failureReason: null,
      balanceAfter: pen('0'),
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 4,
    });

    expect(operation.status).toBe('completed');
    expect(operation.version).toBe(4);
  });
});
