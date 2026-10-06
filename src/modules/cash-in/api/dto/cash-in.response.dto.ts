import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CASH_IN_STATUSES } from '../../domain/cash-in-status.js';
import type { CashInStatus } from '../../domain/cash-in-status.js';

export class CashInResponseDto {
  @ApiProperty({ example: 'op_6f9c2d7e-4b1a-4c55-9d0e-2a7f8b3c1d10' })
  operation_id!: string;

  @ApiProperty({ enum: CASH_IN_STATUSES, example: 'completed' })
  status!: CashInStatus;

  @ApiProperty({ example: 100 })
  amount!: number;

  @ApiPropertyOptional({
    example: 350,
    description: 'Balance right after this credit. Only when completed.',
  })
  new_balance?: number;

  @ApiPropertyOptional({
    example: 'insufficient_funds',
    description: 'Only when failed.',
  })
  failure_reason?: string;
}
