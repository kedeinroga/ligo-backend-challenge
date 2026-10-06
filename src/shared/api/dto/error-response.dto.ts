import { ApiProperty } from '@nestjs/swagger';

/** Shape of every error response of the API. */
export class ErrorResponseDto {
  @ApiProperty({ example: 422 })
  statusCode: number;

  @ApiProperty({ example: 'insufficient-funds-exception' })
  code: string;

  @ApiProperty({ example: 'Unprocessable Entity' })
  errorMessage: string;

  @ApiProperty({ example: 'Insufficient funds: balance is 10.00 PEN' })
  errorMessageDescription: string;

  @ApiProperty({ example: '/cash-in' })
  path: string;

  @ApiProperty({ example: '2026-10-05T20:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: '7d1f5c2e-9a4b-4c1e-8f7a-2b3c4d5e6f70' })
  traceId: string;
}
