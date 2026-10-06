import { LoggerService } from '@nestjs/common';
import { LogsService } from '../../application/ports/logs.service.js';

/**
 * Routes Nest's internal logs (bootstrap, route mapping, framework errors)
 * through LogsService, so every line on stdout has the same JSON schema.
 * Nest passes the context as the last string argument, and the stack as the
 * first extra argument of error().
 */
export class NestLoggerAdapter implements LoggerService {
  constructor(private readonly logs: LogsService) {}

  log(message: unknown, ...params: unknown[]): void {
    this.logs.info(this.text(message), this.context(params));
  }

  warn(message: unknown, ...params: unknown[]): void {
    this.logs.warn(this.text(message), this.context(params));
  }

  error(message: unknown, ...params: unknown[]): void {
    const [stack] = params;
    const hasStack = params.length > 1 && typeof stack === 'string';
    this.logs.error(
      this.text(message),
      message instanceof Error ? message : undefined,
      { ...this.context(params), ...(hasStack ? { stack } : {}) },
    );
  }

  fatal(message: unknown, ...params: unknown[]): void {
    this.error(message, ...params);
  }

  debug(message: unknown, ...params: unknown[]): void {
    this.logs.info(this.text(message), this.context(params));
  }

  verbose(message: unknown, ...params: unknown[]): void {
    this.logs.info(this.text(message), this.context(params));
  }

  private text(message: unknown): string {
    if (message instanceof Error) return message.message;
    return typeof message === 'string' ? message : JSON.stringify(message);
  }

  private context(params: unknown[]): { context?: string } {
    const last = params.at(-1);
    return typeof last === 'string' ? { context: last } : {};
  }
}
