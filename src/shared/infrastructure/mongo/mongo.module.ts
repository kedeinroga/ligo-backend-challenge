import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { Db, MongoClient } from 'mongodb';
import { AppConfigService } from '../../../config/app-config.service.js';
import { MongoHealthCheck } from './mongo.health-check.js';
import { MONGO_CLIENT, MONGO_DB } from './mongo.tokens.js';

@Global()
@Module({
  providers: [
    {
      provide: MONGO_CLIENT,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): Promise<MongoClient> =>
        new MongoClient(config.mongoUri, {
          // int64 fields (money in minor units) round trip as bigint, never as float.
          useBigInt64: true,
          serverSelectionTimeoutMS: config.mongoServerSelectionTimeoutMs,
        }).connect(),
    },
    {
      provide: MONGO_DB,
      inject: [MONGO_CLIENT, AppConfigService],
      useFactory: (client: MongoClient, config: AppConfigService): Db =>
        client.db(config.mongoDb),
    },
    MongoHealthCheck,
  ],
  exports: [MONGO_CLIENT, MONGO_DB, MongoHealthCheck],
})
export class MongoModule implements OnApplicationShutdown {
  constructor(@Inject(MONGO_CLIENT) private readonly client: MongoClient) {}

  async onApplicationShutdown(): Promise<void> {
    await this.client.close();
  }
}
