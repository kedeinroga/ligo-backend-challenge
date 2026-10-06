import { Command } from '@nestjs/cqrs';
import { Traced } from '../../../../../shared/application/traced.js';
import { ReconciliationResult } from '../../cash-in.results.js';

export class ReconcilePendingOperationsCommand
  extends Command<ReconciliationResult>
  implements Traced
{
  constructor(readonly traceId: string) {
    super();
  }
}
