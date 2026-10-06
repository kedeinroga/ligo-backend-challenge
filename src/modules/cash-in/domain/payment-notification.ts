import { TransitionResult } from './transition-result.js';

export const PAYMENT_NOTIFICATION_TYPES = [
  'payment.processing',
  'payment.succeeded',
  'payment.failed',
] as const;
export type PaymentNotificationType =
  (typeof PAYMENT_NOTIFICATION_TYPES)[number];

/** A provider notification already handled, kept to deduplicate by `notificationId`. */
export class PaymentNotification {
  private constructor(
    readonly notificationId: string,
    readonly operationId: string,
    readonly type: PaymentNotificationType,
    readonly result: TransitionResult,
    readonly receivedAt: Date,
  ) {}

  static record(props: {
    notificationId: string;
    operationId: string;
    type: PaymentNotificationType;
    result: TransitionResult;
  }): PaymentNotification {
    return new PaymentNotification(
      props.notificationId,
      props.operationId,
      props.type,
      props.result,
      new Date(),
    );
  }
}
