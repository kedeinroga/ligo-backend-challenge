import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { setupApp } from '../src/app.setup.js';

describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = setupApp(moduleRef.createNestApplication({ rawBody: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports every dependency as up', async () => {
    const res = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200);
    expect(res.body).toEqual({
      status: 'up',
      dependencies: { mongo: { status: 'up' } },
    });
  });

  it('propagates the trace id', async () => {
    const res = await request(app.getHttpServer())
      .get('/health/live')
      .set('x-trace-id', 'abc-123')
      .expect(200);
    expect(res.headers['x-trace-id']).toBe('abc-123');
  });

  it('never serves cached responses (no ETag, no-store)', async () => {
    const first = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200);

    expect(first.headers['cache-control']).toBe('no-store');
    expect(first.headers['etag']).toBeUndefined();
    await request(app.getHttpServer())
      .get('/health/ready')
      .set('If-None-Match', '*')
      .expect(200);
  });
});
