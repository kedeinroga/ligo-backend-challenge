import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsNumber,
  IsPositive,
  IsString,
  Matches,
  Max,
  MaxLength,
} from 'class-validator';
import { CURRENCIES } from '../../../../shared/domain/index.js';

/** Input sanity limit, not a business rule. */
export const MAX_CASH_IN_AMOUNT = 1_000_000;

export class CashInRequestDto {
  @ApiProperty({ example: 'usr_abc123' })
  @IsString()
  @MaxLength(64)
  @Matches(/^usr_[A-Za-z0-9_-]{1,60}$/)
  user_id!: string;

  @ApiProperty({ example: 100.0, description: 'Positive, at most 2 decimals' })
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @IsPositive()
  @Max(MAX_CASH_IN_AMOUNT)
  amount!: number;

  @ApiProperty({ example: 'PEN', enum: CURRENCIES })
  @IsIn(CURRENCIES)
  currency!: string;

  @ApiProperty({
    example: 'card_xyz',
    description:
      'Simulated provider cards: card_declined, card_timeout, card_slow, card_unavailable; anything else is approved',
  })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/)
  payment_method!: string;
}
