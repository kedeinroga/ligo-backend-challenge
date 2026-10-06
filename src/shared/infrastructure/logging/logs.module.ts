import { Global, Module } from '@nestjs/common';
import { LogsService } from '../../application/ports/logs.service.js';
import { JsonLogsService } from './json-logs.service.js';

@Global()
@Module({
  providers: [{ provide: LogsService, useClass: JsonLogsService }],
  exports: [LogsService],
})
export class LogsModule {}
