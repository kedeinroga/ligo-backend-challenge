import { HttpStatus } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { Test } from '@nestjs/testing';
import type { Response } from 'express';
import { Money } from '../../../shared/domain/index.js';
import { CashInResult } from '../application/cash-in.results.js';
import { InitiateCashInCommand } from '../application/commands/initiate-cash-in/initiate-cash-in.command.js';
import { CashInController } from './cash-in.controller.js';
import { CashInRequestDto } from './dto/cash-in.request.dto.js';

const body: CashInRequestDto = {
  user_id: 'usr_abc123',
  amount: 10.05,
  currency: 'PEN',
  payment_method: 'card_xyz',
};

const completed: CashInResult = {
  operationId: 'op_1',
  status: 'completed',
  amount: Money.of('100', 'PEN'),
  newBalance: Money.of('350', 'PEN'),
  failureReason: null,
};

describe(CashInController.name, () => {
  const execute = vi.fn();
  const status = vi.fn();
  const res = { status } as unknown as Response;
  let controller: CashInController;

  beforeEach(async () => {
    execute.mockReset();
    status.mockReset();
    const moduleRef = await Test.createTestingModule({
      controllers: [CashInController],
      providers: [{ provide: CommandBus, useValue: { execute } }],
    }).compile();
    controller = moduleRef.get(CashInController);
  });

  it('builds the command with the decimal string amount and the given key', async () => {
    execute.mockResolvedValue(completed);

    await controller.cashIn('trace-1', 'key-1', body, res);

    expect(execute).toHaveBeenCalledWith(
      new InitiateCashInCommand(
        'usr_abc123',
        'key-1',
        '10.05',
        'PEN',
        'card_xyz',
        'trace-1',
      ),
    );
  });

  it('answers 200 with new_balance for a completed operation', async () => {
    execute.mockResolvedValue(completed);

    const response = await controller.cashIn('t', 'k', body, res);

    expect(status).not.toHaveBeenCalled();
    expect(response).toEqual({
      operation_id: 'op_1',
      status: 'completed',
      amount: 100,
      new_balance: 350,
    });
  });

  it('answers 200 with failure_reason and without new_balance for a failed operation', async () => {
    execute.mockResolvedValue({
      ...completed,
      status: 'failed',
      newBalance: null,
      failureReason: 'insufficient_funds',
    } satisfies CashInResult);

    const response = await controller.cashIn('t', 'k', body, res);

    expect(status).not.toHaveBeenCalled();
    expect(response).toEqual({
      operation_id: 'op_1',
      status: 'failed',
      amount: 100,
      failure_reason: 'insufficient_funds',
    });
  });

  it('answers 202 without new_balance for a pending operation', async () => {
    execute.mockResolvedValue({
      ...completed,
      status: 'pending',
      newBalance: null,
    } satisfies CashInResult);

    const response = await controller.cashIn('t', 'k', body, res);

    expect(status).toHaveBeenCalledWith(HttpStatus.ACCEPTED);
    expect(response).toEqual({
      operation_id: 'op_1',
      status: 'pending',
      amount: 100,
    });
  });
});
