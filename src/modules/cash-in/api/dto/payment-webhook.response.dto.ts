import { ApiProperty } from '@nestjs/swagger';

const WEBHOOK_RESULTS = [
  'applied',
  'ignored',
  'conflict',
  'duplicate',
] as const;

export class PaymentWebhookResponseDto {
  @ApiProperty({ enum: WEBHOOK_RESULTS, example: 'applied' })
  result!: (typeof WEBHOOK_RESULTS)[number];
}
