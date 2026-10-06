import { ArgumentsHost, NotFoundException } from '@nestjs/common';
import {
  AuthenticationException,
  BusinessRuleViolationException,
  CurrencyMismatchException,
  DataSourceException,
} from '../../domain/index.js';
import { NoopLogsService } from '../../infrastructure/in-memory/noop-logs.service.js';
import { GenericExceptionFilter } from './generic-exception.filter.js';

class InsufficientFunds extends BusinessRuleViolationException {
  static override readonly staticCode: string = 'insufficient-funds-exception';
  override readonly instanceCode: string = InsufficientFunds.staticCode;
}

function run(exception: unknown) {
  const json = vi.fn<(body: Record<string, unknown>) => void>();
  const status = vi.fn((_code: number) => ({ json }));
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({
        method: 'POST',
        originalUrl: '/x',
        globalTraceId: 'trace-1',
      }),
      getResponse: () => ({ status }),
    }),
  } as unknown as ArgumentsHost;

  new GenericExceptionFilter(new NoopLogsService()).catch(exception, host);
  return { status: status.mock.calls[0][0], body: json.mock.calls[0][0] };
}

class InvalidSignature extends AuthenticationException {
  static override readonly staticCode: string = 'invalid-signature-exception';
  override readonly instanceCode: string = InvalidSignature.staticCode;
}

describe(GenericExceptionFilter.name, () => {
  it('maps a subclass through its closest mapped ancestor, keeping its code and message', () => {
    const { status, body } = run(new InsufficientFunds('balance is 1.00 PEN'));

    expect(status).toBe(422);
    expect(body).toMatchObject({
      statusCode: 422,
      code: 'insufficient-funds-exception',
      errorMessage: 'Unprocessable Entity',
      errorMessageDescription: 'balance is 1.00 PEN',
      path: '/x',
      traceId: 'trace-1',
    });
  });

  it('maps exceptions declared in the domain kernel', () => {
    expect(run(new CurrencyMismatchException('PEN vs USD')).body).toMatchObject(
      {
        statusCode: 400,
        code: 'currency-mismatch-exception',
      },
    );
  });

  it('maps an authentication failure to 401, keeping its code and message', () => {
    expect(
      run(new InvalidSignature('signature does not match')).body,
    ).toMatchObject({
      statusCode: 401,
      code: 'invalid-signature-exception',
      errorMessage: 'Unauthorized',
      errorMessageDescription: 'signature does not match',
    });
  });

  it('hides internal details on 5xx', () => {
    const { body } = run(new DataSourceException('connection string x'));

    expect(body.statusCode).toBe(500);
    expect(body.errorMessageDescription).toBe('A data store error occurred.');
  });

  it('keeps the status of framework HTTP exceptions', () => {
    expect(run(new NotFoundException('Cannot GET /nope')).body).toMatchObject({
      statusCode: 404,
      code: 'http-404',
    });
  });

  it('returns a generic 500 for unknown errors', () => {
    expect(run(new Error('boom')).body).toMatchObject({
      statusCode: 500,
      code: 'default-exception',
      errorMessageDescription: 'An unexpected error occurred.',
    });
  });
});
