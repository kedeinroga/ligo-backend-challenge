import {
  DependencyHealthCheck,
  DependencyHealthChecks,
} from '../../../../../shared/application/ports/dependency-health-check.port.js';
import { NoopLogsService } from '../../../../../shared/infrastructure/in-memory/noop-logs.service.js';
import { CheckReadinessHandler } from './check-readiness.handler.js';
import { CheckReadinessQuery } from './check-readiness.query.js';

class FakeCheck extends DependencyHealthCheck {
  constructor(
    readonly name: string,
    private readonly behavior: 'up' | 'down' | 'hangs',
  ) {
    super();
  }

  check(): Promise<void> {
    if (this.behavior === 'hangs') return new Promise(() => undefined);
    return this.behavior === 'up'
      ? Promise.resolve()
      : Promise.reject(new Error('down'));
  }
}

describe(CheckReadinessHandler.name, () => {
  const handlerWith = (...checks: DependencyHealthCheck[]) =>
    new CheckReadinessHandler(
      new DependencyHealthChecks(checks, 50),
      new NoopLogsService(),
    );

  it('is up when every dependency is up', async () => {
    const report = await handlerWith(
      new FakeCheck('mongo', 'up'),
      new FakeCheck('redis', 'up'),
    ).execute(new CheckReadinessQuery('trace-1'));

    expect(report).toEqual({
      status: 'up',
      dependencies: { mongo: { status: 'up' }, redis: { status: 'up' } },
    });
  });

  it('is down when any dependency is down, and says which', async () => {
    const report = await handlerWith(
      new FakeCheck('mongo', 'up'),
      new FakeCheck('redis', 'down'),
    ).execute(new CheckReadinessQuery('trace-1'));

    expect(report.status).toBe('down');
    expect(report.dependencies.redis).toEqual({
      status: 'down',
      error: 'Error: down',
    });
  });

  it('reports a hung dependency as down once its budget is spent', async () => {
    const startedAt = Date.now();
    const report = await handlerWith(
      new FakeCheck('mongo', 'hangs'),
      new FakeCheck('redis', 'up'),
    ).execute(new CheckReadinessQuery('trace-1'));

    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(report.status).toBe('down');
    expect(report.dependencies.mongo).toEqual({
      status: 'down',
      error: 'Error: timeout after 50ms',
    });
    expect(report.dependencies.redis).toEqual({ status: 'up' });
  });
});
