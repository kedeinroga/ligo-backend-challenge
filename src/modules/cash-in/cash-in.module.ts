import { Module } from '@nestjs/common';
import { CashInUnitOfWork } from './application/ports/cash-in-unit-of-work.port.js';
import { CashInOperationRepository } from './domain/cash-in-operation.repository.js';
import { WalletRepository } from './domain/wallet.repository.js';
import { MongoCashInUnitOfWork } from './infrastructure/mongo-cash-in.unit-of-work.js';
import { MongoCashInOperationRepository } from './infrastructure/mongo-cash-in-operation.repository.js';
import { MongoWalletRepository } from './infrastructure/mongo-wallet.repository.js';

@Module({
  providers: [
    {
      provide: CashInOperationRepository,
      useClass: MongoCashInOperationRepository,
    },
    { provide: WalletRepository, useClass: MongoWalletRepository },
    { provide: CashInUnitOfWork, useClass: MongoCashInUnitOfWork },
  ],
})
export class CashInModule {}
