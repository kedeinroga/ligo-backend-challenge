import { Currency, Money } from '../../../shared/domain/index.js';
import { LedgerEntry } from './ledger-entry.js';
import {
  InvalidCreditAmountException,
  WalletCurrencyMismatchException,
} from './wallet.exceptions.js';

export interface WalletProps {
  readonly userId: string;
  readonly balance: Money;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly version: number;
}

/** A user's balance in one currency, fixed by the first cash-in. */
export class Wallet {
  private _balance: Money;
  private _updatedAt: Date;

  private constructor(private readonly props: WalletProps) {
    this._balance = props.balance;
    this._updatedAt = props.updatedAt;
  }

  static open(userId: string, currency: Currency): Wallet {
    const now = new Date();
    return new Wallet({
      userId,
      balance: Money.zero(currency),
      createdAt: now,
      updatedAt: now,
      version: 0,
    });
  }

  static rehydrate(props: WalletProps): Wallet {
    return new Wallet(props);
  }

  /** Fails fast, before charging, when a credit of `amount` could never be applied. */
  assertCanBeCredited(amount: Money): void {
    if (amount.currency !== this._balance.currency) {
      throw new WalletCurrencyMismatchException(
        this._balance.currency,
        amount.currency,
      );
    }
    if (!amount.isPositive()) {
      throw new InvalidCreditAmountException(amount.toDecimalString());
    }
  }

  credit(amount: Money, operationId: string): LedgerEntry {
    this.assertCanBeCredited(amount);
    this._balance = this._balance.add(amount);
    this._updatedAt = new Date();
    return LedgerEntry.record({
      operationId,
      userId: this.props.userId,
      amount,
      balanceAfter: this._balance,
    });
  }

  get userId(): string {
    return this.props.userId;
  }

  get balance(): Money {
    return this._balance;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  get version(): number {
    return this.props.version;
  }
}
