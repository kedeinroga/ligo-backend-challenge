import { ApiProperty } from '@nestjs/swagger';
import type {
  HealthStatus,
  ReadinessReport,
} from '../../application/queries/check-readiness/check-readiness.query.js';

export class LivenessResponseDto {
  @ApiProperty({ enum: ['up'] })
  status: 'up';
}

export class ReadinessResponseDto implements ReadinessReport {
  @ApiProperty({ enum: ['up', 'down'] })
  status: HealthStatus;

  @ApiProperty({
    example: { mongo: { status: 'up' } },
  })
  dependencies: ReadinessReport['dependencies'];
}
