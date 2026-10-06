import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { CqrsModule } from '@nestjs/cqrs';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppConfigModule } from './config/app-config.module.js';
import { AppConfigService } from './config/app-config.service.js';
import { CashInModule } from './modules/cash-in/cash-in.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { GenericExceptionFilter } from './shared/api/filters/generic-exception.filter.js';
import { LoggerMiddleware } from './shared/api/middleware/logger.middleware.js';
import { NoStoreMiddleware } from './shared/api/middleware/no-store.middleware.js';
import { InfrastructureModule } from './shared/infrastructure/infrastructure.module.js';

@Module({
  imports: [
    AppConfigModule,
    // In memory counters: per pod. With several replicas the limit is per pod, not global.
    ThrottlerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => [
        {
          name: 'default',
          ttl: config.throttleTtlMs,
          limit: config.throttleLimit,
        },
      ],
    }),
    CqrsModule.forRoot(),
    InfrastructureModule.forRoot(),
    HealthModule,
    CashInModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: GenericExceptionFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(LoggerMiddleware, NoStoreMiddleware).forRoutes('*path');
  }
}
