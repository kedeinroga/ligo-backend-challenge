import {
  AuthenticationException,
  BusinessRuleViolationException,
  DataConflictException,
} from '../../../shared/domain/index.js';

export class PaymentNotificationMismatchException extends BusinessRuleViolationException {
  static override readonly staticCode: string =
    'payment-notification-mismatch-exception';
  override readonly instanceCode: string =
    PaymentNotificationMismatchException.staticCode;

  constructor(operationId: string, expected: string, received: string) {
    super(
      `Notification for ${operationId} reports ${received} but the operation is ${expected}`,
    );
  }
}

export class DuplicatePaymentNotificationException extends DataConflictException {
  static override readonly staticCode: string =
    'duplicate-payment-notification-exception';
  override readonly instanceCode: string =
    DuplicatePaymentNotificationException.staticCode;

  constructor(notificationId: string, options?: ErrorOptions) {
    super(`Notification ${notificationId} was already handled`, options);
  }
}

export class InvalidWebhookSignatureException extends AuthenticationException {
  static override readonly staticCode: string =
    'invalid-webhook-signature-exception';
  override readonly instanceCode: string =
    InvalidWebhookSignatureException.staticCode;

  constructor(reason: string) {
    super(`Invalid webhook signature: ${reason}`);
  }
}
