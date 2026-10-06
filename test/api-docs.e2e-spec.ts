import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { setupApp } from '../src/app.setup.js';

describe('API docs (e2e)', () => {
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

  it('serves the OpenAPI document', async () => {
    const res = await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200);

    expect(res.body.openapi).toMatch(/^3\./);
    expect(res.body.paths['/health/ready']).toBeDefined();
    expect(res.body.paths['/cash-in']).toBeDefined();
    expect(res.body.paths['/webhooks/payment']).toBeDefined();
  });

  it('serves the Scalar API reference', async () => {
    const res = await request(app.getHttpServer())
      .get('/reference')
      .expect(200);

    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('@scalar/api-reference');
  });
});
