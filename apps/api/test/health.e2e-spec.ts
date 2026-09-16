import supertest from 'supertest';
const request = (supertest as any).default || supertest;
import { INestApplication } from '@nestjs/common';
import { TestAppHelper } from './helpers/test-app.helper';

describe('Sprint 16: System Health & Probes E2E Tests', () => {
  let testApp: TestAppHelper;
  let app: INestApplication;

  beforeAll(async () => {
    testApp = new TestAppHelper();
    app = await testApp.init();
  });

  afterAll(async () => {
    await testApp.close();
  });

  describe('1. Liveness Probe', () => {
    it('GET /api/v1/health/liveness -> should return 200 OK with server uptime', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/health/liveness');

      expect(res.status).toBe(200);
      const data = res.body.data || res.body;
      expect(data).toHaveProperty('status', 'ok');
      expect(data).toHaveProperty('uptime');
      expect(typeof data.uptime).toBe('number');
      expect(data).toHaveProperty('timestamp');
    });
  });
});
