import { Wallet } from '../../domain/wallet.aggregate.js';
import { WalletConcurrentlyModifiedException } from '../../domain/wallet.exceptions.js';
import { WalletRepository } from '../../domain/wallet.repository.js';

/** Test double: stores copies and checks versions like the Mongo adapter. */
export class InMemoryWalletRepository extends WalletRepository {
  private readonly stored = new Map<string, Wallet>();

  findByUserId(userId: string): Promise<Wallet | null> {
    const found = this.stored.get(userId);
    return Promise.resolve(found ? copyOf(found, found.version) : null);
  }

  insertIfAbsent(wallet: Wallet): Promise<Wallet> {
    const existing = this.stored.get(wallet.userId);
    if (!existing) {
      this.stored.set(wallet.userId, copyOf(wallet, wallet.version));
    }
    return this.findByUserId(wallet.userId) as Promise<Wallet>;
  }

  /** Used by the in-memory unit of work before it applies anything. */
  assertVersion(wallet: Wallet): void {
    if (this.stored.get(wallet.userId)?.version !== wallet.version) {
      throw new WalletConcurrentlyModifiedException(wallet.userId);
    }
  }

  /** Used by the in-memory unit of work: stores the new balance and bumps the version. */
  apply(wallet: Wallet): void {
    this.stored.set(wallet.userId, copyOf(wallet, wallet.version + 1));
  }
}

function copyOf(wallet: Wallet, version: number): Wallet {
  return Wallet.rehydrate({
    userId: wallet.userId,
    balance: wallet.balance,
    createdAt: wallet.createdAt,
    updatedAt: wallet.updatedAt,
    version,
  });
}
