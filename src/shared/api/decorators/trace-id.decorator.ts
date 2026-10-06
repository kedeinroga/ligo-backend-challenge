import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { ICustomRequest } from '../interfaces/request.interface.js';

/** Controller param: `@TraceId() traceId: string`. */
export const TraceId = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string =>
    ctx.switchToHttp().getRequest<ICustomRequest>().globalTraceId,
);
