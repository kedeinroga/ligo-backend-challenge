import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppConfigService } from '../../../config/app-config.service.js';
import { WebhookSignatureVerifier } from '../application/ports/webhook-signature-verifier.port.js';
import { InvalidWebhookSignatureException } from '../domain/payment-notification.exceptions.js';

const HEADER_PATTERN = /^t=(\d{1,15}),v1=([0-9a-f]{64})$/;

/**
 * Stripe like scheme: header `t=<unix seconds>,v1=<hex>` where
 * `v1 = HMAC_SHA256(secret, "<t>.<raw body>")`. The timestamp is signed, so a
 * captured request cannot be replayed outside the tolerance window.
 */
@Injectable()
export class HmacWebhookSignatureVerifier extends WebhookSignatureVerifier {
  constructor(private readonly config: AppConfigService) {
    super();
  }

  verify(rawBody: Buffer, signatureHeader: string | undefined): void {
    if (!signatureHeader) {
      throw new InvalidWebhookSignatureException('header is missing');
    }
    const match = HEADER_PATTERN.exec(signatureHeader);
    if (!match) {
      throw new InvalidWebhookSignatureException('header is malformed');
    }
    const [, timestamp, signature] = match;

    const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
    if (ageSeconds > this.config.webhookToleranceSeconds) {
      throw new InvalidWebhookSignatureException(
        'timestamp is outside the tolerance',
      );
    }
    const expected = createHmac('sha256', this.config.webhookSigningSecret)
      .update(`${timestamp}.`)
      .update(rawBody)
      .digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) {
      throw new InvalidWebhookSignatureException('signature does not match');
    }
  }
}
