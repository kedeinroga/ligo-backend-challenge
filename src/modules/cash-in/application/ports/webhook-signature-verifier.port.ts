export abstract class WebhookSignatureVerifier {
  /**
   * Verifies the provider signature over the exact bytes received.
   * @throws InvalidWebhookSignatureException when it is missing, malformed, wrong or too old.
   */
  abstract verify(rawBody: Buffer, signatureHeader: string | undefined): void;
}
