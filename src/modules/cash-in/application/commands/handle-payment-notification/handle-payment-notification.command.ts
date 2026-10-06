import { Command } from '@nestjs/cqrs';
import { Traced } from '../../../../../shared/application/traced.js';
import { PaymentNotificationType } from '../../../domain/payment-notification.js';
import { PaymentNotificationResult } from '../../cash-in.results.js';

export class HandlePaymentNotificationCommand
  extends Command<PaymentNotificationResult>
  implements Traced
{
  constructor(
    /** Provider event id: the deduplication key. */
    readonly notificationId: string,
    readonly type: PaymentNotificationType,
    readonly operationId: string,
    readonly providerChargeId: string | null,
    /** Decimal string such as "100" or "10.05", never a float. */
    readonly amount: string,
    readonly currency: string,
    readonly failureReason: string | null,
    readonly traceId: string,
  ) {
    super();
  }
}
