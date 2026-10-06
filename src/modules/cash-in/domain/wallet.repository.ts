import { Wallet } from './wallet.aggregate.js';

export abstract class WalletRepository {
  abstract findByUserId(userId: string): Promise<Wallet | null>;

  /**
   * Creates the wallet unless it exists; safe under concurrent callers.
   * @returns the persisted wallet, the existing one when it was already there.
   */
  abstract insertIfAbsent(wallet: Wallet): Promise<Wallet>;
}
