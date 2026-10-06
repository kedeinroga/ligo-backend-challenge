import { Module } from '@nestjs/common';
import { HealthController } from './api/health.controller.js';
import { CheckReadinessHandler } from './application/queries/check-readiness/check-readiness.handler.js';

@Module({
  controllers: [HealthController],
  providers: [CheckReadinessHandler],
})
export class HealthModule {}
