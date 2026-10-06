import { createHmac } from 'node:crypto';
import { AppConfigService } from '../../../config/app-config.service.js';
import { InvalidWebhookSignatureException } from '../domain/payment-notification.exceptions.js';
import { HmacWebhookSignatureVerifier } from './hmac-webhook-signature.verifier.js';

const SECRET = 'unit-test-signing-secret';
const TOLERANCE_SECONDS = 300;
const body = Buffer.from('{"event_id":"evt_1"}');

const verifier = new HmacWebhookSignatureVerifier({
  webhookSigningSecret: SECRET,
  webhookToleranceSeconds: TOLERANCE_SECONDS,
} as AppConfigService);

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

function sign(
  payload: Buffer,
  options: { secret?: string; timestamp?: number } = {},
): string {
  const timestamp = options.timestamp ?? nowSeconds();
  const v1 = createHmac('sha256', options.secret ?? SECRET)
    .update(`${timestamp}.`)
    .update(payload)
    .digest('hex');
  return `t=${timestamp},v1=${v1}`;
}

describe(HmacWebhookSignatureVerifier.name, () => {
  it('accepts a valid signature', () => {
    expect(() => verifier.verify(body, sign(body))).not.toThrow();
  });

  it('rejects a tampered body', () => {
    expect(() =>
      verifier.verify(Buffer.from('{"event_id":"evt_2"}'), sign(body)),
    ).toThrow(InvalidWebhookSignatureException);
  });

  it('rejects a signature made with another secret', () => {
    expect(() =>
      verifier.verify(body, sign(body, { secret: 'another-secret-entirely' })),
    ).toThrow(InvalidWebhookSignatureException);
  });

  it('rejects an expired timestamp even when the signature is valid', () => {
    const old = nowSeconds() - TOLERANCE_SECONDS - 5;

    expect(() => verifier.verify(body, sign(body, { timestamp: old }))).toThrow(
      InvalidWebhookSignatureException,
    );
  });

  it('rejects a timestamp too far in the future', () => {
    const future = nowSeconds() + TOLERANCE_SECONDS + 5;

    expect(() =>
      verifier.verify(body, sign(body, { timestamp: future })),
    ).toThrow(InvalidWebhookSignatureException);
  });

  it.each([
    'garbage',
    't=1,v1=zz',
    `t=${nowSeconds()}`,
    'v1=' + 'a'.repeat(64),
  ])('rejects a malformed header (%s)', (header) => {
    expect(() => verifier.verify(body, header)).toThrow(
      InvalidWebhookSignatureException,
    );
  });

  it('rejects a missing header', () => {
    expect(() => verifier.verify(body, undefined)).toThrow(
      InvalidWebhookSignatureException,
    );
  });
});
