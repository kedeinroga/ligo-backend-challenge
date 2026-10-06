import { Module } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service.js';
import { LogsService } from '../../shared/application/ports/logs.service.js';
import { CashInProcessor } from './application/cash-in-processor.js';
import { CashInSettings } from './application/cash-in.settings.js';
import { InitiateCashInHandler } from './application/commands/initiate-cash-in/initiate-cash-in.handler.js';
import { CashInController } from './api/cash-in.controller.js';
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
  controllers: [CashInController],
  providers: [
    {
      provide: CashInOperationRepository,
      useClass: MongoCashInOperationRepository,
    },
    { provide: WalletRepository, useClass: MongoWalletRepository },
    { provide: CashInUnitOfWork, useClass: MongoCashInUnitOfWork },
    { provide: PaymentProvider, useClass: SimulatedPaymentProvider },
    SimulatedProviderBackend,
    {
      provide: CashInSettings,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): CashInSettings =>
        new CashInSettings(config.operationLeaseMs, {
          maxAttempts: config.settlementMaxAttempts,
          baseDelayMs: config.retryBaseDelayMs,
          maxDelayMs: config.retryMaxDelayMs,
        }),
    },
    {
      provide: CashInProcessor,
      inject: [
        CashInOperationRepository,
        WalletRepository,
        CashInUnitOfWork,
        PaymentProvider,
        CashInSettings,
        LogsService,
      ],
      useFactory: (
        operations: CashInOperationRepository,
        wallets: WalletRepository,
        unitOfWork: CashInUnitOfWork,
        provider: PaymentProvider,
        settings: CashInSettings,
        logger: LogsService,
      ): CashInProcessor =>
        new CashInProcessor(
          operations,
          wallets,
          unitOfWork,
          provider,
          settings,
          logger,
        ),
    },
    InitiateCashInHandler,
  ],
})
export class CashInModule {}
