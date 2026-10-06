import { Money } from '../../../shared/domain/index.js';
import {
  InvalidCreditAmountException,
  WalletCurrencyMismatchException,
} from './wallet.exceptions.js';
import { Wallet } from './wallet.aggregate.js';

const pen = (amount: string): Money => Money.of(amount, 'PEN');

describe(Wallet.name, () => {
  it('opens with a zero balance in the given currency and version 0', () => {
    const wallet = Wallet.open('usr_1', 'PEN');

    expect(wallet.balance.equals(pen('0'))).toBe(true);
    expect(wallet.version).toBe(0);
  });

  it('adds the credit and returns a ledger entry with the balance after', () => {
    const wallet = Wallet.rehydrate({
      userId: 'usr_1',
      balance: pen('250'),
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 3,
    });

    const entry = wallet.credit(pen('100'), 'op_1');

    expect(wallet.balance.toDecimalString()).toBe('350.00');
    expect(entry.operationId).toBe('op_1');
    expect(entry.amount.toDecimalString()).toBe('100.00');
    expect(entry.balanceAfter.toDecimalString()).toBe('350.00');
    expect(wallet.version).toBe(3);
  });

  it('rejects a credit in another currency on credit and on assertCanBeCredited', () => {
    const wallet = Wallet.open('usr_1', 'PEN');
    const usd = Money.of('10', 'USD');

    expect(() => wallet.credit(usd, 'op_1')).toThrow(
      WalletCurrencyMismatchException,
    );
    expect(() => wallet.assertCanBeCredited(usd)).toThrow(
      WalletCurrencyMismatchException,
    );
    expect(wallet.balance.equals(pen('0'))).toBe(true);
  });

  it('rejects a zero or negative credit and keeps the balance', () => {
    const wallet = Wallet.open('usr_1', 'PEN');

    expect(() => wallet.credit(pen('0'), 'op_1')).toThrow(
      InvalidCreditAmountException,
    );
    expect(() => wallet.credit(pen('-5'), 'op_1')).toThrow(
      InvalidCreditAmountException,
    );
    expect(wallet.balance.equals(pen('0'))).toBe(true);
  });
});
