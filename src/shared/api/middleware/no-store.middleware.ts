import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * Financial data (balances, payment states, readiness) must never be served
 * from a cache: every API response is `no-store`, and conditional request
 * headers are dropped so Express never answers 304 Not Modified (it would for
 * `If-None-Match: *` even without an ETag). ETags are disabled in setupApp.
 */
@Injectable()
export class NoStoreMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    delete req.headers['if-none-match'];
    delete req.headers['if-modified-since'];
    res.setHeader('Cache-Control', 'no-store');
    next();
  }
}
