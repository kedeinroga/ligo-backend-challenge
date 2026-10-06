import {
  BusinessRuleViolationException,
  ConcurrencyException,
  DataInputException,
  DataNotFoundException,
} from '../../../shared/domain/index.js';

export class WalletCurrencyMismatchException extends BusinessRuleViolationException {
  static override readonly staticCode: string =
    'wallet-currency-mismatch-exception';
  override readonly instanceCode: string =
    WalletCurrencyMismatchException.staticCode;

  constructor(walletCurrency: string, creditCurrency: string) {
    super(`Wallet is in ${walletCurrency}, cannot credit ${creditCurrency}`);
  }
}

export class InvalidCreditAmountException extends DataInputException {
  static override readonly staticCode: string =
    'invalid-credit-amount-exception';
  override readonly instanceCode: string =
    InvalidCreditAmountException.staticCode;

  constructor(amount: string) {
    super(`Credit amount must be positive, got ${amount}`);
  }
}

export class WalletNotFoundException extends DataNotFoundException {
  static override readonly staticCode: string = 'wallet-not-found-exception';
  override readonly instanceCode: string = WalletNotFoundException.staticCode;

  constructor(userId: string) {
    super(`Wallet of user ${userId} not found`);
  }
}

export class WalletConcurrentlyModifiedException extends ConcurrencyException {
  static override readonly staticCode: string =
    'wallet-concurrently-modified-exception';
  override readonly instanceCode: string =
    WalletConcurrentlyModifiedException.staticCode;

  constructor(userId: string, options?: ErrorOptions) {
    super(`Wallet of user ${userId} was modified concurrently`, options);
  }
}
