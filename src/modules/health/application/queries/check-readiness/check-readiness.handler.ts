import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { DependencyHealthChecks } from '../../../../../shared/application/ports/dependency-health-check.port.js';
import { withTimeout } from '../../../../../shared/application/with-timeout.js';
import { LogsService } from '../../../../../shared/application/ports/logs.service.js';
import {
  CheckReadinessQuery,
  ReadinessReport,
} from './check-readiness.query.js';

/**
 * Runs every dependency check in parallel, each within its time budget; the
 * service is up only if all are.
 */
@QueryHandler(CheckReadinessQuery)
export class CheckReadinessHandler implements IQueryHandler<CheckReadinessQuery> {
  constructor(
    private readonly healthChecks: DependencyHealthChecks,
    private readonly logger: LogsService,
  ) {}

  async execute({ traceId }: CheckReadinessQuery): Promise<ReadinessReport> {
    const { checks, timeoutMs } = this.healthChecks;
    const results = await Promise.allSettled(
      checks.map((check) => withTimeout(check.check(), timeoutMs)),
    );

    const dependencies: ReadinessReport['dependencies'] = {};
    results.forEach((result, i) => {
      const { name } = checks[i];
      dependencies[name] =
        result.status === 'fulfilled'
          ? { status: 'up' }
          : { status: 'down', error: String(result.reason) };
    });

    const down = Object.keys(dependencies).filter(
      (name) => dependencies[name].status === 'down',
    );
    if (down.length > 0) {
      this.logger.warn('Readiness check failed', { traceId, down });
    }
    return { status: down.length === 0 ? 'up' : 'down', dependencies };
  }
}
