export type LogContext = Record<string, unknown> & { traceId?: string };

/**
 * Structured logging port. Application and infrastructure code log through it,
 * always passing the traceId in the context.
 */
export abstract class LogsService {
  abstract info(message: string, context?: LogContext): void;
  abstract warn(message: string, context?: LogContext): void;
  abstract error(message: string, error?: unknown, context?: LogContext): void;
}
