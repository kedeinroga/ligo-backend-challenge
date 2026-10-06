import { Command } from '@nestjs/cqrs';
import { Traced } from '../../../../../shared/application/traced.js';
import { CashInResult } from '../../cash-in.results.js';

export class InitiateCashInCommand
  extends Command<CashInResult>
  implements Traced
{
  constructor(
    readonly userId: string,
    readonly idempotencyKey: string,
    /** Decimal string such as "100" or "10.05", never a float. */
    readonly amount: string,
    readonly currency: string,
    readonly paymentMethod: string,
    readonly traceId: string,
  ) {
    super();
  }
}
