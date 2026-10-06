import { InvalidIdempotencyKeyException } from '../../domain/cash-in-operation.exceptions.js';
import { parseIdempotencyKey } from './idempotency-key.decorator.js';

describe(parseIdempotencyKey.name, () => {
  it('lowercases a valid UUID', () => {
    expect(parseIdempotencyKey('7B1F1C1E-0000-4000-8000-00000000000A')).toBe(
      '7b1f1c1e-0000-4000-8000-00000000000a',
    );
  });

  it.each([
    undefined,
    '',
    'not-a-uuid',
    ['7b1f1c1e-0000-4000-8000-000000000001'],
  ])('rejects a missing or malformed header (%s)', (header) => {
    expect(() => parseIdempotencyKey(header)).toThrow(
      InvalidIdempotencyKeyException,
    );
  });
});
