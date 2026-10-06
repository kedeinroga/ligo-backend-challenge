import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { Request } from 'express';
import { InvalidIdempotencyKeyException } from '../../domain/cash-in-operation.exceptions.js';

/** Validates the header and lowercases it, so one key has one spelling in the database. */
export function parseIdempotencyKey(header: unknown): string {
  if (typeof header !== 'string' || !isUUID(header)) {
    throw new InvalidIdempotencyKeyException();
  }
  return header.toLowerCase();
}

/** Controller param: `@IdempotencyKey() idempotencyKey: string` (required UUID header). */
export const IdempotencyKey = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string =>
    parseIdempotencyKey(
      ctx.switchToHttp().getRequest<Request>().headers['idempotency-key'],
    ),
);
