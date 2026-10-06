import { Money } from '../../../../shared/domain/index.js';
import { CashInResult } from '../../application/cash-in.results.js';
import { CashInResponseDto } from '../dto/cash-in.response.dto.js';

/** `new_balance` only when completed, `failure_reason` only when failed. */
export function toCashInResponse(result: CashInResult): CashInResponseDto {
  const response: CashInResponseDto = {
    operation_id: result.operationId,
    status: result.status,
    amount: toJsonNumber(result.amount),
  };
  if (result.status === 'completed' && result.newBalance) {
    response.new_balance = toJsonNumber(result.newBalance);
  }
  if (result.status === 'failed' && result.failureReason) {
    response.failure_reason = result.failureReason;
  }
  return response;
}

/** The statement contract renders money as JSON numbers; trailing zeros do not survive JSON. */
function toJsonNumber(money: Money): number {
  return Number(money.toDecimalString());
}
