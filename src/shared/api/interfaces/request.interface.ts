import type { Request } from 'express';

/** Express request enriched by LoggerMiddleware. */
export interface ICustomRequest extends Request {
  globalTraceId: string;
  /** Exact bytes of the body, kept by Nest (`rawBody: true`) to verify webhook signatures. */
  rawBody?: Buffer;
}
