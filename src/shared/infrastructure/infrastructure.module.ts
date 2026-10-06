import { DynamicModule, Global, Module } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service.js';
import {
  DependencyHealthCheck,
  DependencyHealthChecks,
} from '../application/ports/dependency-health-check.port.js';
import { LogsModule } from './logging/logs.module.js';
import { MongoHealthCheck } from './mongo/mongo.health-check.js';
import { MongoModule } from './mongo/mongo.module.js';

/**
 * Binds the shared ports (logs, health) to their adapters. Bounded contexts
 * depend on the ports only.
 */
@Global()
@Module({})
export class InfrastructureModule {
  static forRoot(): DynamicModule {
    const healthChecks = [MongoHealthCheck];

    return {
      module: InfrastructureModule,
      imports: [LogsModule, MongoModule],
      providers: [
        {
          provide: DependencyHealthChecks,
          inject: [AppConfigService, ...healthChecks],
          useFactory: (
            config: AppConfigService,
            ...checks: DependencyHealthCheck[]
          ) => new DependencyHealthChecks(checks, config.healthCheckTimeoutMs),
        },
      ],
      exports: [DependencyHealthChecks],
    };
  }
}
