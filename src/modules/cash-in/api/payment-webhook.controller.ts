import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import {
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiDomainErrors } from '../../../shared/api/decorators/api-domain-errors.decorator.js';
import { TraceId } from '../../../shared/api/decorators/trace-id.decorator.js';
import {
  DataInputException,
  DataSourceException,
} from '../../../shared/domain/index.js';
import { HandlePaymentNotificationCommand } from '../application/commands/handle-payment-notification/handle-payment-notification.command.js';
import {
  CashInOperationConcurrentlyModifiedException,
  CashInOperationNotFoundException,
  LedgerEntryAlreadyRecordedException,
} from '../domain/cash-in-operation.exceptions.js';
import {
  InvalidWebhookSignatureException,
  PaymentNotificationMismatchException,
} from '../domain/payment-notification.exceptions.js';
import {
  WalletConcurrentlyModifiedException,
  WalletNotFoundException,
} from '../domain/wallet.exceptions.js';
import { PaymentWebhookRequestDto } from './dto/payment-webhook.request.dto.js';
import { PaymentWebhookResponseDto } from './dto/payment-webhook.response.dto.js';
import {
  SIGNATURE_HEADER,
  WebhookSignatureGuard,
} from './guards/webhook-signature.guard.js';

@ApiTags('webhooks')
@Controller()
export class PaymentWebhookController {
  constructor(private readonly commandBus: CommandBus) {}

  @ApiOperation({
    summary: 'Receive a payment provider notification',
    operationId: 'paymentWebhook',
  })
  @ApiHeader({
    name: SIGNATURE_HEADER,
    required: true,
    description:
      't=<unix seconds>,v1=<hex HMAC_SHA256(secret, "<t>.<raw body>")>',
  })
  @ApiOkResponse({ type: PaymentWebhookResponseDto })
  @ApiDomainErrors(
    InvalidWebhookSignatureException,
    DataInputException,
    CashInOperationNotFoundException,
    WalletNotFoundException,
    PaymentNotificationMismatchException,
    CashInOperationConcurrentlyModifiedException,
    WalletConcurrentlyModifiedException,
    LedgerEntryAlreadyRecordedException,
    DataSourceException,
  )
  @HttpCode(HttpStatus.OK)
  // The provider must never be rate limited: a 429 would only make it retry.
  @SkipThrottle()
  @UseGuards(WebhookSignatureGuard)
  @Post('webhooks/payment')
  async paymentWebhook(
    @TraceId() traceId: string,
    @Body() body: PaymentWebhookRequestDto,
  ): Promise<PaymentWebhookResponseDto> {
    return this.commandBus.execute(
      new HandlePaymentNotificationCommand(
        body.event_id,
        body.type,
        body.operation_id,
        body.provider_charge_id ?? null,
        String(body.amount),
        body.currency,
        body.failure_reason ?? null,
        traceId,
      ),
    );
  }
}
