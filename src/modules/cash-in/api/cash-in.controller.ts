import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Res,
} from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import {
  ApiAcceptedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiDomainErrors } from '../../../shared/api/decorators/api-domain-errors.decorator.js';
import { TraceId } from '../../../shared/api/decorators/trace-id.decorator.js';
import {
  DataInputException,
  DataSourceException,
} from '../../../shared/domain/index.js';
import { InitiateCashInCommand } from '../application/commands/initiate-cash-in/initiate-cash-in.command.js';
import {
  IdempotencyKeyReusedException,
  InvalidIdempotencyKeyException,
} from '../domain/cash-in-operation.exceptions.js';
import { WalletCurrencyMismatchException } from '../domain/wallet.exceptions.js';
import { IdempotencyKey } from './decorators/idempotency-key.decorator.js';
import { CashInRequestDto } from './dto/cash-in.request.dto.js';
import { CashInResponseDto } from './dto/cash-in.response.dto.js';
import { toCashInResponse } from './mappers/cash-in.response.mapper.js';

@ApiTags('cash-in')
@Controller()
export class CashInController {
  constructor(private readonly commandBus: CommandBus) {}

  @ApiOperation({
    summary: 'Top up a wallet through the payment provider',
    operationId: 'cashIn',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOkResponse({
    type: CashInResponseDto,
    description: 'completed or failed',
  })
  @ApiAcceptedResponse({
    type: CashInResponseDto,
    description: 'pending: retry with the same Idempotency-Key',
  })
  @ApiDomainErrors(
    InvalidIdempotencyKeyException,
    DataInputException,
    IdempotencyKeyReusedException,
    WalletCurrencyMismatchException,
    DataSourceException,
  )
  @HttpCode(HttpStatus.OK)
  @Post('cash-in')
  async cashIn(
    @TraceId() traceId: string,
    @IdempotencyKey() idempotencyKey: string,
    @Body() body: CashInRequestDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CashInResponseDto> {
    const result = await this.commandBus.execute(
      new InitiateCashInCommand(
        body.user_id,
        idempotencyKey,
        // Shortest round trip decimal ("100", "10.05"): never float arithmetic.
        String(body.amount),
        body.currency,
        body.payment_method,
        traceId,
      ),
    );
    if (result.status === 'pending') {
      res.status(HttpStatus.ACCEPTED);
    }
    return toCashInResponse(result);
  }
}
