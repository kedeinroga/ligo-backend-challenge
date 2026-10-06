import { ExecutionContext } from '@nestjs/common';
import { WebhookSignatureVerifier } from '../../application/ports/webhook-signature-verifier.port.js';
import { InvalidWebhookSignatureException } from '../../domain/payment-notification.exceptions.js';
import { WebhookSignatureGuard } from './webhook-signature.guard.js';

function contextOf(request: object): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe(WebhookSignatureGuard.name, () => {
  const verify = vi.fn();
  const guard = new WebhookSignatureGuard({
    verify,
  } as WebhookSignatureVerifier);

  beforeEach(() => {
    verify.mockReset();
  });

  it('passes the raw body and the signature header to the verifier', () => {
    const rawBody = Buffer.from('{}');

    const allowed = guard.canActivate(
      contextOf({ rawBody, headers: { 'x-provider-signature': 't=1,v1=ab' } }),
    );

    expect(allowed).toBe(true);
    expect(verify).toHaveBeenCalledWith(rawBody, 't=1,v1=ab');
  });

  it('throws what the verifier throws', () => {
    verify.mockImplementation(() => {
      throw new InvalidWebhookSignatureException('signature does not match');
    });

    expect(() =>
      guard.canActivate(contextOf({ rawBody: Buffer.from('{}'), headers: {} })),
    ).toThrow(InvalidWebhookSignatureException);
  });

  it('rejects a request without a raw body without calling the verifier', () => {
    expect(() => guard.canActivate(contextOf({ headers: {} }))).toThrow(
      InvalidWebhookSignatureException,
    );
    expect(verify).not.toHaveBeenCalled();
  });
});
