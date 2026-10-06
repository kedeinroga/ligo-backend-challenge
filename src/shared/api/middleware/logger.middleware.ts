import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { LogsService } from '../../application/ports/logs.service.js';
import { ICustomRequest } from '../interfaces/request.interface.js';

export const TRACE_ID_HEADER = 'x-trace-id';

/** Probes hit these every few seconds; Kubernetes already reports their failures. */
const UNLOGGED_PATH_PREFIXES = ['/health/'];

/**
 * Assigns the request traceId (accepts an inbound x-trace-id from the gateway
 * or creates one), echoes it in the response and logs start and finish,
 * except for probe endpoints.
 */
@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  constructor(private readonly logger: LogsService) {}

  use(req: ICustomRequest, res: Response, next: NextFunction): void {
    const traceId = req.header(TRACE_ID_HEADER) ?? randomUUID();
    req.globalTraceId = traceId;
    res.setHeader(TRACE_ID_HEADER, traceId);

    const { method, originalUrl: url } = req;
    if (UNLOGGED_PATH_PREFIXES.some((prefix) => url.startsWith(prefix))) {
      next();
      return;
    }

    const startedAt = Date.now();
    this.logger.info('Request started', { traceId, method, url });

    res.on('finish', () => {
      this.logger.info('Request finished', {
        traceId,
        method,
        url,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
      });
    });

    next();
  }
}
