import { Inject, Injectable } from '@nestjs/common';
import { Collection, Db } from 'mongodb';
import { DataSourceException } from '../../../shared/domain/index.js';
import {
  isDuplicateKeyError,
  translateDriverErrors,
} from '../../../shared/infrastructure/mongo/mongo-errors.js';
import { MONGO_DB } from '../../../shared/infrastructure/mongo/mongo.tokens.js';
import { Wallet } from '../domain/wallet.aggregate.js';
import { WalletRepository } from '../domain/wallet.repository.js';
import {
  toWallet,
  toWalletDocument,
  WalletDocument,
} from './mappers/wallet.mapper.js';

export const WALLETS_COLLECTION = 'wallets';

@Injectable()
export class MongoWalletRepository extends WalletRepository {
  private readonly wallets: Collection<WalletDocument>;

  constructor(@Inject(MONGO_DB) db: Db) {
    super();
    this.wallets = db.collection(WALLETS_COLLECTION);
  }

  async findByUserId(userId: string): Promise<Wallet | null> {
    const document = await translateDriverErrors('Failed to load wallet', () =>
      this.wallets.findOne({ _id: userId }),
    );
    return document ? toWallet(document) : null;
  }

  async insertIfAbsent(wallet: Wallet): Promise<Wallet> {
    const { _id, ...fields } = toWalletDocument(wallet);
    const document = await translateDriverErrors(
      'Failed to create wallet',
      async () => {
        try {
          await this.wallets.updateOne(
            { _id },
            { $setOnInsert: fields },
            { upsert: true },
          );
        } catch (error) {
          // A concurrent upsert of the same wallet won the race: read theirs.
          if (!isDuplicateKeyError(error)) {
            throw error;
          }
        }
        return this.wallets.findOne({ _id });
      },
    );
    if (!document) {
      throw new DataSourceException(`Wallet ${_id} missing after upsert`);
    }
    return toWallet(document);
  }
}
