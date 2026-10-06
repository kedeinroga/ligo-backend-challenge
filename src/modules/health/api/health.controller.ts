import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { TraceId } from '../../../shared/api/decorators/trace-id.decorator.js';
import { CheckReadinessQuery } from '../application/queries/check-readiness/check-readiness.query.js';
import {
  LivenessResponseDto,
  ReadinessResponseDto,
} from './dto/readiness.response.dto.js';

/** Kubernetes probes. Not rate limited. */
@ApiTags('health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly queryBus: QueryBus) {}

  @ApiOperation({ summary: 'Liveness probe', operationId: 'healthLive' })
  @ApiOkResponse({ type: LivenessResponseDto })
  @Get('live')
  live(): LivenessResponseDto {
    return { status: 'up' };
  }

  @ApiOperation({ summary: 'Readiness probe', operationId: 'healthReady' })
  @ApiOkResponse({ type: ReadinessResponseDto })
  @ApiServiceUnavailableResponse({ type: ReadinessResponseDto })
  @Get('ready')
  async ready(
    @TraceId() traceId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ReadinessResponseDto> {
    const report = await this.queryBus.execute(
      new CheckReadinessQuery(traceId),
    );
    if (report.status === 'down') {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return report;
  }
}
