import { EventEmitter } from 'node:events';
import type { Response } from 'express';
import { LogsService } from '../../application/ports/logs.service.js';
import { ICustomRequest } from '../interfaces/request.interface.js';
import { LoggerMiddleware, TRACE_ID_HEADER } from './logger.middleware.js';

function run(url: string, inboundTraceId?: string) {
  const logs = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const req = {
    method: 'GET',
    originalUrl: url,
    header: (name: string) =>
      name === TRACE_ID_HEADER ? inboundTraceId : undefined,
  } as unknown as ICustomRequest;
  const res = Object.assign(new EventEmitter(), {
    statusCode: 200,
    setHeader: vi.fn(),
  });
  const next = vi.fn();

  new LoggerMiddleware(logs as unknown as LogsService).use(
    req,
    res as unknown as Response,
    next,
  );
  res.emit('finish');
  return { logs, req, res, next };
}

describe(LoggerMiddleware.name, () => {
  it('keeps the inbound traceId and echoes it', () => {
    const { req, res, next } = run('/cash-in', 'trace-1');

    expect(req.globalTraceId).toBe('trace-1');
    expect(res.setHeader).toHaveBeenCalledWith(TRACE_ID_HEADER, 'trace-1');
    expect(next).toHaveBeenCalled();
  });

  it('creates a traceId when none is sent', () => {
    expect(run('/cash-in').req.globalTraceId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('logs start and finish with the duration', () => {
    const { logs } = run('/cash-in', 'trace-1');

    expect(logs.info).toHaveBeenNthCalledWith(1, 'Request started', {
      traceId: 'trace-1',
      method: 'GET',
      url: '/cash-in',
    });
    expect(logs.info).toHaveBeenNthCalledWith(
      2,
      'Request finished',
      expect.objectContaining({
        statusCode: 200,
        durationMs: expect.any(Number),
      }),
    );
  });

  it('does not log probe endpoints but still assigns the traceId', () => {
    const { logs, req, next } = run('/health/live');

    expect(logs.info).not.toHaveBeenCalled();
    expect(req.globalTraceId).toBeDefined();
    expect(next).toHaveBeenCalled();
  });
});
