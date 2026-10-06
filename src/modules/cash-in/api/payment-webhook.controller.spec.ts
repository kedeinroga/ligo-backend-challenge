import { CommandBus } from '@nestjs/cqrs';
import { Test } from '@nestjs/testing';
import { HandlePaymentNotificationCommand } from '../application/commands/handle-payment-notification/handle-payment-notification.command.js';
import { PaymentWebhookRequestDto } from './dto/payment-webhook.request.dto.js';
import { WebhookSignatureGuard } from './guards/webhook-signature.guard.js';
import { PaymentWebhookController } from './payment-webhook.controller.js';

const OPERATION_ID = 'op_6f9c2d7e-4b1a-4c55-9d0e-2a7f8b3c1d10';

describe(PaymentWebhookController.name, () => {
  const execute = vi.fn();
  let controller: PaymentWebhookController;

  beforeEach(async () => {
    execute.mockReset();
    const moduleRef = await Test.createTestingModule({
      controllers: [PaymentWebhookController],
      providers: [{ provide: CommandBus, useValue: { execute } }],
    })
      // The guard has its own spec; here only the controller mapping is under test.
      .overrideGuard(WebhookSignatureGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(PaymentWebhookController);
  });

  it('builds the command with the decimal string amount and returns the result', async () => {
    execute.mockResolvedValue({ result: 'applied' });
    const body: PaymentWebhookRequestDto = {
      event_id: 'evt_1',
      type: 'payment.succeeded',
      operation_id: OPERATION_ID,
      provider_charge_id: 'ch_1',
      amount: 10.05,
      currency: 'PEN',
    };

    const response = await controller.paymentWebhook('trace-1', body);

    expect(execute).toHaveBeenCalledWith(
      new HandlePaymentNotificationCommand(
        'evt_1',
        'payment.succeeded',
        OPERATION_ID,
        'ch_1',
        '10.05',
        'PEN',
        null,
        'trace-1',
      ),
    );
    expect(response).toEqual({ result: 'applied' });
  });

  it('passes the failure reason of a failed notification', async () => {
    execute.mockResolvedValue({ result: 'applied' });

    await controller.paymentWebhook('trace-1', {
      event_id: 'evt_2',
      type: 'payment.failed',
      operation_id: OPERATION_ID,
      amount: 100,
      currency: 'PEN',
      failure_reason: 'insufficient_funds',
    });

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        providerChargeId: null,
        failureReason: 'insufficient_funds',
      }),
    );
  });
});
