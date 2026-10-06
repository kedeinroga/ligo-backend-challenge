import { Query } from '@nestjs/cqrs';
import { Traced } from '../../../../../shared/application/traced.js';

export type HealthStatus = 'up' | 'down';

export interface ReadinessReport {
  status: HealthStatus;
  dependencies: Record<string, { status: HealthStatus; error?: string }>;
}

export class CheckReadinessQuery
  extends Query<ReadinessReport>
  implements Traced
{
  constructor(readonly traceId: string) {
    super();
  }
}
