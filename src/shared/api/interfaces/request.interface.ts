import type { Request } from 'express';

/** Express request enriched by LoggerMiddleware. */
export interface ICustomRequest extends Request {
  globalTraceId: string;
}
