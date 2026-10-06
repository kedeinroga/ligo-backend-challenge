import { LogsService } from '../../application/ports/logs.service.js';

/** Silent logger for unit tests. */
export class NoopLogsService extends LogsService {
  info(): void {}
  warn(): void {}
  error(): void {}
}
