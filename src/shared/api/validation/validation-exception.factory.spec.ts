import { ValidationError } from '@nestjs/common';
import { DataInputException } from '../../domain/index.js';
import {
  validationExceptionFactory,
  validationMessages,
} from './validation-exception.factory.js';

const error = (
  property: string,
  constraints?: Record<string, string>,
  children: ValidationError[] = [],
): ValidationError => ({ property, constraints, children });

describe(validationMessages.name, () => {
  it('keeps top level messages as class-validator writes them', () => {
    expect(
      validationMessages([
        error('amount', {
          matches: 'amount must be a positive decimal string',
          maxLength: 'amount must be shorter than or equal to 20 characters',
        }),
      ]),
    ).toEqual([
      'amount must be a positive decimal string',
      'amount must be shorter than or equal to 20 characters',
    ]);
  });

  it('prefixes nested fields with their parent path', () => {
    expect(
      validationMessages([
        error('payer', undefined, [
          error('address', undefined, [
            error('street', { isString: 'street must be a string' }),
          ]),
        ]),
      ]),
    ).toEqual(['payer.address.street must be a string']);
  });
});

describe(validationExceptionFactory.name, () => {
  it('returns a DataInputException with every message', () => {
    const exception = validationExceptionFactory([
      error('currency', { isIn: 'currency must be one of PEN, USD' }),
      error('amount', { isString: 'amount must be a string' }),
    ]);

    expect(exception).toBeInstanceOf(DataInputException);
    expect(exception.message).toBe(
      'currency must be one of PEN, USD; amount must be a string',
    );
  });
});
