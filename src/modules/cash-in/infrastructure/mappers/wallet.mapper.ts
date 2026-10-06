import { Money } from '../../../../shared/domain/index.js';
import { Wallet } from '../../domain/wallet.aggregate.js';

export interface WalletDocument {
  _id: string;
  currency: string;
  balanceMinor: bigint;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export function toWalletDocument(wallet: Wallet): WalletDocument {
  return {
    _id: wallet.userId,
    currency: wallet.balance.currency,
    balanceMinor: wallet.balance.minorUnits,
    version: wallet.version,
    createdAt: wallet.createdAt,
    updatedAt: wallet.updatedAt,
  };
}

export function toWallet(document: WalletDocument): Wallet {
  return Wallet.rehydrate({
    userId: document._id,
    balance: Money.ofMinor(document.balanceMinor, document.currency),
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    version: document.version,
  });
}
