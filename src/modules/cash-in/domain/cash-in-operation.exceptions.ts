import {
  BusinessRuleViolationException,
  ConcurrencyException,
  DataConflictException,
  DataInputException,
  DataNotFoundException,
} from '../../../shared/domain/index.js';

export class InvalidCashInAmountException extends DataInputException {
  static override readonly staticCode: string =
    'invalid-cash-in-amount-exception';
  override readonly instanceCode: string =
    InvalidCashInAmountException.staticCode;

  constructor(amount: string) {
    super(`Cash-in amount must be positive, got ${amount}`);
  }
}

export class InvalidPaymentMethodException extends DataInputException {
  static override readonly staticCode: string =
    'invalid-payment-method-exception';
  override readonly instanceCode: string =
    InvalidPaymentMethodException.staticCode;

  constructor(maxLength: number) {
    super(`Payment method must have between 1 and ${maxLength} characters`);
  }
}

export class InvalidIdempotencyKeyException extends DataInputException {
  static override readonly staticCode: string =
    'invalid-idempotency-key-exception';
  override readonly instanceCode: string =
    InvalidIdempotencyKeyException.staticCode;

  constructor() {
    super('The Idempotency-Key header is required and must be a UUID');
  }
}

export class IdempotencyKeyReusedException extends BusinessRuleViolationException {
  static override readonly staticCode: string =
    'idempotency-key-reused-exception';
  override readonly instanceCode: string =
    IdempotencyKeyReusedException.staticCode;

  constructor(operationId: string) {
    super(
      `Idempotency key already used by ${operationId} with a different amount, currency or payment method`,
    );
  }
}

export class CashInOperationNotFoundException extends DataNotFoundException {
  static override readonly staticCode: string =
    'cash-in-operation-not-found-exception';
  override readonly instanceCode: string =
    CashInOperationNotFoundException.staticCode;

  constructor(operationId: string) {
    super(`Cash-in operation ${operationId} not found`);
  }
}

export class DuplicateCashInOperationException extends DataConflictException {
  static override readonly staticCode: string =
    'duplicate-cash-in-operation-exception';
  override readonly instanceCode: string =
    DuplicateCashInOperationException.staticCode;

  constructor(userId: string, options?: ErrorOptions) {
    super(`User ${userId} already has an operation with this key`, options);
  }
}

export class CashInOperationConcurrentlyModifiedException extends ConcurrencyException {
  static override readonly staticCode: string =
    'cash-in-operation-concurrently-modified-exception';
  override readonly instanceCode: string =
    CashInOperationConcurrentlyModifiedException.staticCode;

  constructor(operationId: string, options?: ErrorOptions) {
    super(
      `Cash-in operation ${operationId} was modified concurrently`,
      options,
    );
  }
}

export class LedgerEntryAlreadyRecordedException extends DataConflictException {
  static override readonly staticCode: string =
    'ledger-entry-already-recorded-exception';
  override readonly instanceCode: string =
    LedgerEntryAlreadyRecordedException.staticCode;

  constructor(operationId: string, options?: ErrorOptions) {
    super(`Operation ${operationId} was already credited`, options);
  }
}
