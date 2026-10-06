import { Injectable } from '@nestjs/common';
import {
  LogContext,
  LogsService,
} from '../../application/ports/logs.service.js';

type Level = 'info' | 'warn' | 'error';

interface SerializedError {
  name: string;
  message: string;
  stack?: string;
  cause?: SerializedError | string;
}

const MAX_CAUSE_DEPTH = 5;

/**
 * Keeps the root cause: adapters wrap driver errors in DomainExceptions with
 * `{ cause }`, and without the chain the log would only say "Failed to read".
 * The stack is kept for the outermost error only.
 */
function serializeError(error: unknown, depth = 0): SerializedError | string {
  if (!(error instanceof Error)) {
    return typeof error === 'string' ? error : JSON.stringify(error);
  }
  const serialized: SerializedError = {
    name: error.name,
    message: error.message,
    ...(depth === 0 ? { stack: error.stack } : {}),
  };
  if (error.cause !== undefined && depth < MAX_CAUSE_DEPTH) {
    serialized.cause = serializeError(error.cause, depth + 1);
  }
  return serialized;
}

/** One JSON object per line on stdout/stderr, ready for any log collector. */
@Injectable()
export class JsonLogsService extends LogsService {
  info(message: string, context?: LogContext): void {
    this.write('info', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.write('warn', message, context);
  }

  error(message: string, error?: unknown, context?: LogContext): void {
    this.write('error', message, {
      ...context,
      ...(error === undefined ? {} : { error: serializeError(error) }),
    });
  }

  private write(level: Level, message: string, context?: LogContext): void {
    const line = JSON.stringify({
      level,
      message,
      ...context,
      time: new Date().toISOString(),
    });
    (level === 'error' ? process.stderr : process.stdout).write(`${line}\n`);
  }
}
