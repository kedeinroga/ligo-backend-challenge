import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNumber,
  IsPositive,
  IsString,
  Matches,
  Max,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { CURRENCIES } from '../../../../shared/domain/index.js';
import { PAYMENT_NOTIFICATION_TYPES } from '../../domain/payment-notification.js';
import type { PaymentNotificationType } from '../../domain/payment-notification.js';
import { MAX_CASH_IN_AMOUNT } from './cash-in.request.dto.js';

export class PaymentWebhookRequestDto {
  @ApiProperty({
    example: 'evt_123',
    description: 'Provider event id: deduplication key',
  })
  @Matches(/^[A-Za-z0-9_-]{1,100}$/)
  event_id!: string;

  @ApiProperty({
    enum: PAYMENT_NOTIFICATION_TYPES,
    example: 'payment.succeeded',
  })
  @IsIn(PAYMENT_NOTIFICATION_TYPES)
  type!: PaymentNotificationType;

  @ApiProperty({ example: 'op_6f9c2d7e-4b1a-4c55-9d0e-2a7f8b3c1d10' })
  @Matches(/^op_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  operation_id!: string;

  @ApiPropertyOptional({
    example: 'ch_123',
    description: 'Required for payment.succeeded',
  })
  @ValidateIf(
    (body: PaymentWebhookRequestDto) =>
      body.type === 'payment.succeeded' ||
      body.provider_charge_id !== undefined,
  )
  @IsString()
  @MaxLength(100)
  provider_charge_id?: string;

  @ApiProperty({ example: 100.0 })
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @IsPositive()
  @Max(MAX_CASH_IN_AMOUNT)
  amount!: number;

  @ApiProperty({ example: 'PEN', enum: CURRENCIES })
  @IsIn(CURRENCIES)
  currency!: string;

  @ApiPropertyOptional({
    example: 'insufficient_funds',
    description: 'Required for payment.failed',
  })
  @ValidateIf(
    (body: PaymentWebhookRequestDto) =>
      body.type === 'payment.failed' || body.failure_reason !== undefined,
  )
  @IsString()
  @MaxLength(200)
  failure_reason?: string;
}
