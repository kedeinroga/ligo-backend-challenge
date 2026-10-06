import { DataSourceException } from '../../domain/index.js';
import { JsonLogsService } from './json-logs.service.js';

describe(JsonLogsService.name, () => {
  const capture = (stream: NodeJS.WriteStream) => {
    const spy = vi.spyOn(stream, 'write').mockImplementation(() => true);
    return () => JSON.parse(String(spy.mock.calls[0][0]));
  };

  afterEach(() => vi.restoreAllMocks());

  it('writes info as one JSON line on stdout with the context', () => {
    const line = capture(process.stdout);
    new JsonLogsService().info('Money deposited', { traceId: 't-1' });

    expect(line()).toEqual({
      level: 'info',
      message: 'Money deposited',
      traceId: 't-1',
      time: expect.any(String),
    });
  });

  it('writes errors on stderr keeping the whole cause chain', () => {
    const line = capture(process.stderr);
    const driverError = new Error('Server selection timed out after 5000 ms');
    driverError.name = 'MongoServerSelectionError';
    const error = new DataSourceException('Failed to read wallet view', {
      cause: driverError,
    });

    new JsonLogsService().error('Request failed', error, { traceId: 't-1' });

    expect(line().error).toEqual({
      name: 'DataSourceException',
      message: 'Failed to read wallet view',
      stack: expect.stringContaining('DataSourceException'),
      cause: {
        name: 'MongoServerSelectionError',
        message: 'Server selection timed out after 5000 ms',
      },
    });
  });

  it('accepts non Error values', () => {
    const line = capture(process.stderr);
    new JsonLogsService().error('Odd failure', { code: 42 });

    expect(line().error).toBe('{"code":42}');
  });
});
