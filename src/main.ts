import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { setupApp } from './app.setup.js';
import { AppConfigService } from './config/app-config.service.js';
import { LogsService } from './shared/application/ports/logs.service.js';
import { NestLoggerAdapter } from './shared/infrastructure/logging/nest-logger.adapter.js';

async function bootstrap() {
  // Buffer Nest's own logs until LogsService exists: one JSON schema for every line.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logs = app.get(LogsService);
  app.useLogger(new NestLoggerAdapter(logs));
  setupApp(app);

  const { port } = app.get(AppConfigService);
  await app.listen(port, '0.0.0.0');
  logs.info('Server started', { port });
}
await bootstrap();
