import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../../../config/app-config.service.js';
import { LogsService } from '../../../shared/application/ports/logs.service.js';
import { retryWithBackoff } from '../../../shared/application/retry.js';
import {
  TimeoutExceededError,
  withTimeout,
} from '../../../shared/application/with-timeout.js';
import {
  ChargeOutcome,
  ChargeRequest,
  PaymentProvider,
  UnknownOutcomeCause,
} from '../application/ports/payment-provider.port.js';
import {
  ProviderAnswer,
  ProviderUnavailableError,
  SimulatedProviderBackend,
} from './simulated-provider/simulated-provider.backend.js';

/**
 * Adapter over the simulated provider. Every attempt has a timeout. A timeout
 * is not retried inside the request (the latency budget is spent; the client,
 * the webhook or the reconciler resolve it). An unavailable provider is retried
 * a bounded number of times, always with the same idempotency key.
 */
@Injectable()
export class SimulatedPaymentProvider extends PaymentProvider {
  constructor(
    private readonly backend: SimulatedProviderBackend,
    private readonly config: AppConfigService,
    private readonly logger: LogsService,
  ) {
    super();
  }

  async charge(
    request: ChargeRequest,
    traceId: string,
  ): Promise<ChargeOutcome> {
    const context = { traceId, operationId: request.operationId };
    try {
      const answer = await retryWithBackoff(
        (attempt) => this.submit(request, attempt, traceId),
        {
          maxAttempts: this.config.providerMaxAttempts,
          baseDelayMs: this.config.retryBaseDelayMs,
          maxDelayMs: this.config.retryMaxDelayMs,
        },
        (error) => error instanceof ProviderUnavailableError,
      );
      const outcome = toOutcome(answer);
      this.logger.info('Provider charge outcome', {
        ...context,
        outcome: outcome.kind,
      });
      return outcome;
    } catch (error) {
      const cause = unknownCause(error);
      if (cause === 'error') {
        this.logger.error(
          'Provider charge failed unexpectedly',
          error,
          context,
        );
      }
      this.logger.warn('Provider charge outcome unknown', {
        ...context,
        cause,
      });
      return { kind: 'unknown', cause };
    }
  }

  private submit(
    request: ChargeRequest,
    attempt: number,
    traceId: string,
  ): Promise<ProviderAnswer> {
    this.logger.info('Provider charge submitted', {
      traceId,
      operationId: request.operationId,
      attempt,
    });
    return withTimeout(
      this.backend.submit(request),
      this.config.providerTimeoutMs,
    );
  }
}

function toOutcome(answer: ProviderAnswer): ChargeOutcome {
  return answer.outcome === 'approved'
    ? { kind: 'approved', providerChargeId: answer.providerChargeId }
    : { kind: 'declined', reason: answer.reason };
}

function unknownCause(error: unknown): UnknownOutcomeCause {
  if (error instanceof TimeoutExceededError) {
    return 'timeout';
  }
  return error instanceof ProviderUnavailableError ? 'unavailable' : 'error';
}
