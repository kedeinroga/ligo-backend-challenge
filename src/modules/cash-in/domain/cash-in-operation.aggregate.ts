import { Money } from '../../../shared/domain/index.js';
import { CashInStatus } from './cash-in-status.js';
import {
  IdempotencyKeyReusedException,
  InvalidCashInAmountException,
  InvalidPaymentMethodException,
} from './cash-in-operation.exceptions.js';
import { LedgerEntry } from './ledger-entry.js';
import { PaymentNotificationMismatchException } from './payment-notification.exceptions.js';
import { TransitionResult } from './transition-result.js';
import { Wallet } from './wallet.aggregate.js';

const MAX_PAYMENT_METHOD_LENGTH = 64;

export interface CashInOperationProps {
  readonly id: string;
  readonly userId: string;
  readonly idempotencyKey: string;
  readonly amount: Money;
  readonly paymentMethod: string;
  readonly status: CashInStatus;
  readonly providerChargeId: string | null;
  readonly failureReason: string | null;
  readonly balanceAfter: Money | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly version: number;
}

export type CompletionResult =
  | { readonly result: 'applied'; readonly ledgerEntry: LedgerEntry }
  | { readonly result: 'ignored' | 'conflict' };

/**
 * One top up attempt, unique per (user, idempotency key). Terminal states are
 * absorbing: a late or duplicated provider outcome never moves them.
 */
export class CashInOperation {
  private _status: CashInStatus;
  private _providerChargeId: string | null;
  private _failureReason: string | null;
  private _balanceAfter: Money | null;
  private _updatedAt: Date;

  private constructor(private readonly props: CashInOperationProps) {
    this._status = props.status;
    this._providerChargeId = props.providerChargeId;
    this._failureReason = props.failureReason;
    this._balanceAfter = props.balanceAfter;
    this._updatedAt = props.updatedAt;
  }

  static initiate(props: {
    id: string;
    userId: string;
    idempotencyKey: string;
    amount: Money;
    paymentMethod: string;
  }): CashInOperation {
    if (!props.amount.isPositive()) {
      throw new InvalidCashInAmountException(props.amount.toDecimalString());
    }
    const method = props.paymentMethod;
    if (
      method.trim().length === 0 ||
      method.length > MAX_PAYMENT_METHOD_LENGTH
    ) {
      throw new InvalidPaymentMethodException(MAX_PAYMENT_METHOD_LENGTH);
    }
    const now = new Date();
    return new CashInOperation({
      ...props,
      status: 'pending',
      providerChargeId: null,
      failureReason: null,
      balanceAfter: null,
      createdAt: now,
      updatedAt: now,
      version: 0,
    });
  }

  static rehydrate(props: CashInOperationProps): CashInOperation {
    return new CashInOperation(props);
  }

  /** A replay of the key must carry the original amount, currency and payment method. */
  assertSameRequest(amount: Money, paymentMethod: string): void {
    if (
      !amount.equals(this.props.amount) ||
      paymentMethod !== this.props.paymentMethod
    ) {
      throw new IdempotencyKeyReusedException(this.props.id);
    }
  }

  assertNotificationAmount(amount: Money): void {
    if (!amount.equals(this.props.amount)) {
      throw new PaymentNotificationMismatchException(
        this.props.id,
        `${this.props.amount.toDecimalString()} ${this.props.amount.currency}`,
        `${amount.toDecimalString()} ${amount.currency}`,
      );
    }
  }

  /**
   * The provider charged the user. From `pending` credits the wallet (the caller
   * persists operation, wallet and ledger entry atomically); already completed
   * is a duplicate confirmation; failed contradicts the terminal state.
   */
  markCompleted(providerChargeId: string, wallet: Wallet): CompletionResult {
    if (this._status === 'completed') {
      return { result: 'ignored' };
    }
    if (this._status === 'failed') {
      return { result: 'conflict' };
    }
    const ledgerEntry = wallet.credit(this.props.amount, this.props.id);
    this._status = 'completed';
    this._providerChargeId = providerChargeId;
    this._balanceAfter = ledgerEntry.balanceAfter;
    this._updatedAt = new Date();
    return { result: 'applied', ledgerEntry };
  }

  markFailed(reason: string): TransitionResult {
    if (this._status === 'failed') {
      return 'ignored';
    }
    if (this._status === 'completed') {
      return 'conflict';
    }
    this._status = 'failed';
    this._failureReason = reason;
    this._updatedAt = new Date();
    return 'applied';
  }

  isFinal(): boolean {
    return this._status !== 'pending';
  }

  get id(): string {
    return this.props.id;
  }

  get userId(): string {
    return this.props.userId;
  }

  get idempotencyKey(): string {
    return this.props.idempotencyKey;
  }

  get amount(): Money {
    return this.props.amount;
  }

  get paymentMethod(): string {
    return this.props.paymentMethod;
  }

  get status(): CashInStatus {
    return this._status;
  }

  get providerChargeId(): string | null {
    return this._providerChargeId;
  }

  get failureReason(): string | null {
    return this._failureReason;
  }

  get balanceAfter(): Money | null {
    return this._balanceAfter;
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
