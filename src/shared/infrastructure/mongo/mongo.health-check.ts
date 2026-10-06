import { Inject, Injectable } from '@nestjs/common';
import { Db } from 'mongodb';
import { DependencyHealthCheck } from '../../application/ports/dependency-health-check.port.js';
import { MONGO_DB } from './mongo.tokens.js';

@Injectable()
export class MongoHealthCheck extends DependencyHealthCheck {
  readonly name = 'mongo';

  constructor(@Inject(MONGO_DB) private readonly db: Db) {
    super();
  }

  async check(): Promise<void> {
    await this.db.command({ ping: 1 });
  }
}
