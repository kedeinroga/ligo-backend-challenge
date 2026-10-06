import { LogsService } from '../../application/ports/logs.service.js';
import { NestLoggerAdapter } from './nest-logger.adapter.js';

describe(NestLoggerAdapter.name, () => {
  const setup = () => {
    const logs = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    return {
      logs,
      adapter: new NestLoggerAdapter(logs as unknown as LogsService),
    };
  };

  it('maps log() to info with the Nest context', () => {
    const { logs, adapter } = setup();
    adapter.log('Nest application successfully started', 'NestApplication');

    expect(logs.info).toHaveBeenCalledWith(
      'Nest application successfully started',
      { context: 'NestApplication' },
    );
  });

  it('keeps the stack Nest passes to error()', () => {
    const { logs, adapter } = setup();
    adapter.error('Boom', 'Error: Boom\n    at x', 'ExceptionHandler');

    expect(logs.error).toHaveBeenCalledWith('Boom', undefined, {
      context: 'ExceptionHandler',
      stack: 'Error: Boom\n    at x',
    });
  });

  it('accepts Error objects and non string messages', () => {
    const { logs, adapter } = setup();
    const error = new Error('db down');
    adapter.error(error);
    adapter.warn({ detail: 1 });

    expect(logs.error).toHaveBeenCalledWith('db down', error, {});
    expect(logs.warn).toHaveBeenCalledWith('{"detail":1}', {});
  });
});
