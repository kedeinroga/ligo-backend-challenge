import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Collection, Db } from 'mongodb';
import { AppConfigService } from '../../../../config/app-config.service.js';
import { isDuplicateKeyError } from '../../../../shared/infrastructure/mongo/mongo-errors.js';
import { MONGO_DB } from '../../../../shared/infrastructure/mongo/mongo.tokens.js';
import { ChargeRequest } from '../../application/ports/payment-provider.port.js';

export const SIMULATED_CHARGES_COLLECTION = 'simulated_provider_charges';

/** Deterministic test cards (`payment_method`). */
const CARD_DECLINED = 'card_declined';
const CARD_TIMEOUT = 'card_timeout';
const CARD_SLOW = 'card_slow';
const CARD_UNAVAILABLE = 'card_unavailable';

const DECLINE_REASON = 'insufficient_funds';

export class ProviderUnavailableError extends Error {
  constructor() {
    super('payment provider unavailable');
    this.name = 'ProviderUnavailableError';
  }
}

export type ProviderAnswer =
  | { readonly outcome: 'approved'; readonly providerChargeId: string }
  | { readonly outcome: 'declined'; readonly reason: string };

interface SimulatedChargeDocument {
  _id: string;
  outcome: 'approved' | 'declined';
  providerChargeId: string | null;
  declineReason: string | null;
  amountMinor: bigint;
  currency: string;
  /** Submissions received for this key: lets tests prove "the provider was called once". */
  calls: number;
  createdAt: Date;
}

/**
 * The provider's side of the simulation, with its own storage in Mongo (not in
 * a Map) so every pod talks to the same provider. A charge is recorded once per
 * idempotency key and every later submission returns the recorded result.
 */
@Injectable()
export class SimulatedProviderBackend {
  private readonly charges: Collection<SimulatedChargeDocument>;

  constructor(
    @Inject(MONGO_DB) db: Db,
    private readonly config: AppConfigService,
  ) {
    this.charges = db.collection(SIMULATED_CHARGES_COLLECTION);
  }

  async submit(request: ChargeRequest): Promise<ProviderAnswer> {
    if (request.paymentMethod === CARD_UNAVAILABLE) {
      throw new ProviderUnavailableError();
    }
    const fresh = this.newCharge(request);
    const before = await this.record(request, fresh);
    await this.simulateLatency(request.paymentMethod, before === null);

    const stored = before ?? fresh;
    return stored.outcome === 'approved' && stored.providerChargeId
      ? { outcome: 'approved', providerChargeId: stored.providerChargeId }
      : { outcome: 'declined', reason: stored.declineReason ?? DECLINE_REASON };
  }

  private newCharge(request: ChargeRequest): SimulatedChargeDocument {
    const declined = request.paymentMethod === CARD_DECLINED;
    return {
      _id: request.operationId,
      outcome: declined ? 'declined' : 'approved',
      providerChargeId: declined ? null : `ch_${randomUUID()}`,
      declineReason: declined ? DECLINE_REASON : null,
      amountMinor: request.amount.minorUnits,
      currency: request.amount.currency,
      calls: 0,
      createdAt: new Date(),
    };
  }

  /** Returns the charge as it was before this submission, `null` when this one created it. */
  private async record(
    request: ChargeRequest,
    fresh: SimulatedChargeDocument,
  ): Promise<SimulatedChargeDocument | null> {
    const { _id, calls: _calls, ...onInsert } = fresh;
    const upsert = (): Promise<SimulatedChargeDocument | null> =>
      this.charges.findOneAndUpdate(
        { _id },
        { $inc: { calls: 1 }, $setOnInsert: onInsert },
        { upsert: true, returnDocument: 'before' },
      );
    try {
      return await upsert();
    } catch (error) {
      // Two concurrent first submissions raced on the upsert: the second now finds it.
      if (isDuplicateKeyError(error)) {
        return upsert();
      }
      throw error;
    }
  }

  private async simulateLatency(
    paymentMethod: string,
    firstSubmission: boolean,
  ): Promise<void> {
    const timeoutMs = this.config.providerTimeoutMs;
    if (paymentMethod === CARD_TIMEOUT && firstSubmission) {
      // The charge is already recorded when the caller gives up.
      await sleep(timeoutMs * 2);
    } else if (paymentMethod === CARD_SLOW) {
      // In flight long enough for concurrent duplicates and early webhooks.
      await sleep(timeoutMs / 2);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
