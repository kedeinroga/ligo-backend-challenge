import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from './env.validation.js';

/**
 * Typed access to the validated environment. Nothing else reads process.env
 * or uses string keys: inject AppConfigService and use its getters.
 */
@Injectable()
export class AppConfigService {
  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  get nodeEnv(): EnvironmentVariables['NODE_ENV'] {
    return this.config.get('NODE_ENV', { infer: true });
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  get port(): number {
    return this.config.get('PORT', { infer: true });
  }

  get mongoUri(): string {
    return this.config.get('MONGO_URI', { infer: true });
  }

  get mongoDb(): string {
    return this.config.get('MONGO_DB', { infer: true });
  }

  get mongoServerSelectionTimeoutMs(): number {
    return this.config.get('MONGO_SERVER_SELECTION_TIMEOUT_MS', {
      infer: true,
    });
  }

  get healthCheckTimeoutMs(): number {
    return this.config.get('HEALTH_CHECK_TIMEOUT_MS', { infer: true });
  }

  get throttleTtlMs(): number {
    return this.config.get('THROTTLE_TTL_MS', { infer: true });
  }

  get throttleLimit(): number {
    return this.config.get('THROTTLE_LIMIT', { infer: true });
  }

  get providerTimeoutMs(): number {
    return this.config.get('PROVIDER_TIMEOUT_MS', { infer: true });
  }

  get providerMaxAttempts(): number {
    return this.config.get('PROVIDER_MAX_ATTEMPTS', { infer: true });
  }

  get retryBaseDelayMs(): number {
    return this.config.get('RETRY_BASE_DELAY_MS', { infer: true });
  }

  get retryMaxDelayMs(): number {
    return this.config.get('RETRY_MAX_DELAY_MS', { infer: true });
  }

  get operationLeaseMs(): number {
    return this.config.get('OPERATION_LEASE_MS', { infer: true });
  }

  get settlementMaxAttempts(): number {
    return this.config.get('SETTLEMENT_MAX_ATTEMPTS', { infer: true });
  }

  get webhookSigningSecret(): string {
    return this.config.get('WEBHOOK_SIGNING_SECRET', { infer: true });
  }

  get webhookToleranceSeconds(): number {
    return this.config.get('WEBHOOK_TOLERANCE_SECONDS', { infer: true });
  }

  get corsAllowedOrigin(): string | string[] {
    const origin = this.config.get('CORS_ALLOWED_ORIGIN', { infer: true });
    return origin === '*' ? origin : origin.split(',').map((o) => o.trim());
  }

  get swaggerEnabled(): boolean {
    return this.config.get('SWAGGER_ENABLED', { infer: true }) ?? false;
  }
}
