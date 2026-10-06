import { DataInputException } from './exceptions/index.js';
import { CurrencyMismatchException, Money } from './money.js';

describe('Money', () => {
  it.each([
    ['10', 1000n],
    ['10.5', 1050n],
    ['10.05', 1005n],
    ['0.01', 1n],
    ['-3.20', -320n],
  ])('parses "%s" into %s minor units', (amount, minor) => {
    expect(Money.of(amount, 'PEN').minorUnits).toBe(minor);
  });

  it.each(['10.123', '1e3', 'abc', '', '10.', '.5'])(
    'rejects invalid amount "%s"',
    (amount) => {
      expect(() => Money.of(amount, 'PEN')).toThrow(DataInputException);
    },
  );

  it('rejects unsupported currencies', () => {
    expect(() => Money.of('1', 'EUR')).toThrow(DataInputException);
  });

  it('adds and subtracts without floating point errors', () => {
    const result = Money.of('0.10', 'PEN')
      .add(Money.of('0.20', 'PEN'))
      .subtract(Money.of('0.30', 'PEN'));
    expect(result.equals(Money.zero('PEN'))).toBe(true);
  });

  it('never mixes currencies', () => {
    expect(() => Money.of('1', 'PEN').add(Money.of('1', 'USD'))).toThrow(
      CurrencyMismatchException,
    );
  });

  it('formats with fixed scale', () => {
    expect(Money.ofMinor(-5n, 'USD').toDecimalString()).toBe('-0.05');
    expect(JSON.stringify(Money.of('7.5', 'USD'))).toBe(
      '{"amount":"7.50","currency":"USD"}',
    );
  });
});
