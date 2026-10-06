import { Module } from '@nestjs/common';
import { PaymentProvider } from './application/ports/payment-provider.port.js';
import { CashInUnitOfWork } from './application/ports/cash-in-unit-of-work.port.js';
import { CashInOperationRepository } from './domain/cash-in-operation.repository.js';
import { WalletRepository } from './domain/wallet.repository.js';
import { MongoCashInUnitOfWork } from './infrastructure/mongo-cash-in.unit-of-work.js';
import { MongoCashInOperationRepository } from './infrastructure/mongo-cash-in-operation.repository.js';
import { MongoWalletRepository } from './infrastructure/mongo-wallet.repository.js';
import { SimulatedPaymentProvider } from './infrastructure/simulated-payment-provider.js';
import { SimulatedProviderBackend } from './infrastructure/simulated-provider/simulated-provider.backend.js';

@Module({
  providers: [
    {
      provide: CashInOperationRepository,
      useClass: MongoCashInOperationRepository,
    },
    { provide: WalletRepository, useClass: MongoWalletRepository },
    { provide: CashInUnitOfWork, useClass: MongoCashInUnitOfWork },
    { provide: PaymentProvider, useClass: SimulatedPaymentProvider },
    SimulatedProviderBackend,
  ],
})
export class CashInModule {}
