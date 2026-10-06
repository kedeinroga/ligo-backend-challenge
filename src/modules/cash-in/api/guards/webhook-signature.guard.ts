import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { WebhookSignatureVerifier } from '../../application/ports/webhook-signature-verifier.port.js';
import { InvalidWebhookSignatureException } from '../../domain/payment-notification.exceptions.js';
import type { ICustomRequest } from '../../../../shared/api/interfaces/request.interface.js';

export const SIGNATURE_HEADER = 'x-provider-signature';

/**
 * Guards run before pipes: an unsigned body never reaches validation. The
 * signature covers the raw bytes, not the parsed JSON.
 */
@Injectable()
export class WebhookSignatureGuard implements CanActivate {
  constructor(private readonly verifier: WebhookSignatureVerifier) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<ICustomRequest>();
    if (!request.rawBody) {
      throw new InvalidWebhookSignatureException('body is missing');
    }
    const header = request.headers[SIGNATURE_HEADER];
    this.verifier.verify(
      request.rawBody,
      typeof header === 'string' ? header : undefined,
    );
    return true;
  }
}
