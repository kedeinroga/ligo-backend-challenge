import { DataInputException } from './exceptions/index.js';

export const CURRENCIES = ['PEN', 'USD'] as const;
export type Currency = (typeof CURRENCIES)[number];

const SCALE = 2;
const FACTOR = 10n ** BigInt(SCALE);
const DECIMAL_PATTERN = /^-?\d+(\.\d{1,2})?$/;

export class CurrencyMismatchException extends DataInputException {
  static override readonly staticCode: string = 'currency-mismatch-exception';
  override readonly instanceCode: string = CurrencyMismatchException.staticCode;
}

/**
 * Immutable amount of money stored as integer minor units (cents) in a bigint.
 * Floating point numbers are never used, and currencies are never mixed.
 */
export class Money {
  private constructor(
    readonly minorUnits: bigint,
    readonly currency: Currency,
  ) {}

  static ofMinor(minorUnits: bigint, currency: string): Money {
    return new Money(minorUnits, Money.assertCurrency(currency));
  }

  /** Parses a decimal string such as "10.50". Numbers are rejected on purpose. */
  static of(amount: string, currency: string): Money {
    if (!DECIMAL_PATTERN.test(amount)) {
      throw new DataInputException(
        `Invalid amount "${amount}": expected a decimal string with up to ${SCALE} decimals`,
      );
    }
    const negative = amount.startsWith('-');
    const [units, fraction = ''] = amount.replace('-', '').split('.');
    const minor =
      BigInt(units) * FACTOR + BigInt(fraction.padEnd(SCALE, '0') || '0');
    return Money.ofMinor(negative ? -minor : minor, currency);
  }

  static zero(currency: string): Money {
    return Money.ofMinor(0n, currency);
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minorUnits + other.minorUnits, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minorUnits - other.minorUnits, this.currency);
  }

  isPositive(): boolean {
    return this.minorUnits > 0n;
  }

  isNegative(): boolean {
    return this.minorUnits < 0n;
  }

  isGreaterThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.minorUnits > other.minorUnits;
  }

  equals(other: Money): boolean {
    return (
      this.currency === other.currency && this.minorUnits === other.minorUnits
    );
  }

  /** Decimal representation with fixed scale, e.g. "10.50". */
  toDecimalString(): string {
    const negative = this.minorUnits < 0n;
    const abs = negative ? -this.minorUnits : this.minorUnits;
    const units = abs / FACTOR;
    const fraction = (abs % FACTOR).toString().padStart(SCALE, '0');
    return `${negative ? '-' : ''}${units}.${fraction}`;
  }

  toJSON(): { amount: string; currency: Currency } {
    return { amount: this.toDecimalString(), currency: this.currency };
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchException(
        `Cannot operate ${this.currency} with ${other.currency}`,
      );
    }
  }

  private static assertCurrency(currency: string): Currency {
    if (!(CURRENCIES as readonly string[]).includes(currency)) {
      throw new DataInputException(`Unsupported currency "${currency}"`);
    }
    return currency as Currency;
  }
}
