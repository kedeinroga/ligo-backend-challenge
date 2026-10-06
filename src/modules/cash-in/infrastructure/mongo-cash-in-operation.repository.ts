import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { Collection, Db, Filter } from 'mongodb';
import {
  isDuplicateKeyError,
  translateDriverErrors,
} from '../../../shared/infrastructure/mongo/mongo-errors.js';
import { MONGO_DB } from '../../../shared/infrastructure/mongo/mongo.tokens.js';
import { CashInOperation } from '../domain/cash-in-operation.aggregate.js';
import { DuplicateCashInOperationException } from '../domain/cash-in-operation.exceptions.js';
import { CashInOperationRepository } from '../domain/cash-in-operation.repository.js';
import {
  CashInOperationDocument,
  toCashInOperation,
  toCashInOperationDocument,
} from './mappers/cash-in-operation.mapper.js';

export const CASH_IN_OPERATIONS_COLLECTION = 'cash_in_operations';

@Injectable()
export class MongoCashInOperationRepository
  extends CashInOperationRepository
  implements OnModuleInit
{
  private readonly operations: Collection<CashInOperationDocument>;

  constructor(@Inject(MONGO_DB) db: Db) {
    super();
    this.operations = db.collection(CASH_IN_OPERATIONS_COLLECTION);
  }

  async onModuleInit(): Promise<void> {
    await translateDriverErrors('Failed to create operation indexes', () =>
      this.operations.createIndexes([
        {
          name: 'uniq_user_idempotency_key',
          key: { userId: 1, idempotencyKey: 1 },
          unique: true,
        },
        {
          name: 'pending_by_age',
          key: { status: 1, createdAt: 1 },
          partialFilterExpression: { status: 'pending' },
        },
      ]),
    );
  }

  async insertClaimed(
    operation: CashInOperation,
    leaseMs: number,
  ): Promise<void> {
    const document = toCashInOperationDocument(operation, {
      leaseUntil: new Date(Date.now() + leaseMs),
      providerCallCount: 1,
    });
    await translateDriverErrors(
      'Failed to insert cash-in operation',
      async () => {
        try {
          await this.operations.insertOne(document);
        } catch (error) {
          if (isDuplicateKeyError(error)) {
            throw new DuplicateCashInOperationException(operation.userId, {
              cause: error,
            });
          }
          throw error;
        }
      },
    );
  }

  findById(id: string): Promise<CashInOperation | null> {
    return this.findOne({ _id: id }, 'Failed to load cash-in operation');
  }

  findByIdempotencyKey(
    userId: string,
    idempotencyKey: string,
  ): Promise<CashInOperation | null> {
    return this.findOne(
      { userId, idempotencyKey },
      'Failed to load cash-in operation by key',
    );
  }

  claim(id: string, leaseMs: number): Promise<CashInOperation | null> {
    return this.claimOne({ _id: id }, leaseMs, undefined);
  }

  claimNextStale(
    createdBefore: Date,
    maxProviderCalls: number,
    leaseMs: number,
  ): Promise<CashInOperation | null> {
    return this.claimOne(
      {
        createdAt: { $lt: createdBefore },
        providerCallCount: { $lt: maxProviderCalls },
      },
      leaseMs,
      { createdAt: 1 },
    );
  }

  async releaseLease(id: string): Promise<void> {
    await translateDriverErrors('Failed to release operation lease', () =>
      this.operations.updateOne(
        { _id: id, status: 'pending' },
        { $set: { leaseUntil: null } },
      ),
    );
  }

  private async findOne(
    filter: Filter<CashInOperationDocument>,
    failureMessage: string,
  ): Promise<CashInOperation | null> {
    const document = await translateDriverErrors(failureMessage, () =>
      this.operations.findOne(filter),
    );
    return document ? toCashInOperation(document) : null;
  }

  /** Atomic: of N concurrent callers exactly one gets the lease. */
  private async claimOne(
    filter: Filter<CashInOperationDocument>,
    leaseMs: number,
    sort: { createdAt: 1 } | undefined,
  ): Promise<CashInOperation | null> {
    const now = new Date();
    const document = await translateDriverErrors(
      'Failed to claim cash-in operation',
      () =>
        this.operations.findOneAndUpdate(
          {
            ...filter,
            status: 'pending',
            $or: [{ leaseUntil: null }, { leaseUntil: { $lt: now } }],
          },
          {
            $set: { leaseUntil: new Date(now.getTime() + leaseMs) },
            $inc: { providerCallCount: 1 },
          },
          { returnDocument: 'after', sort },
        ),
    );
    return document ? toCashInOperation(document) : null;
  }
}
