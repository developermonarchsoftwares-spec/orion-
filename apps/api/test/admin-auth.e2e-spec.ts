import supertest from 'supertest';
const request = (supertest as any).default || supertest;
import { INestApplication } from '@nestjs/common';
import { TestAppHelper } from './helpers/test-app.helper';

describe('Sprint 16: Admin Authentication & Security E2E Tests', () => {
  let testApp: TestAppHelper;
  let app: INestApplication;

  const validAdminEmail = 'qa.admin@monarchsoftwares.com';
  const unauthorizedEmail = 'hacker@unauthorized-domain.com';

  beforeAll(async () => {
    testApp = new TestAppHelper();
    app = await testApp.init();

    await testApp.cleanupUsers([validAdminEmail]);
  });

  afterAll(async () => {
    await testApp.cleanupUsers([validAdminEmail]);
    await testApp.close();
  });

  describe('1. Admin OTP Challenge Flow', () => {
    it('POST /api/v1/admin/auth/send-otp -> should successfully generate OTP for authorized admin email', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/auth/send-otp')
        .send({ email: validAdminEmail });

      expect(res.status).toBe(200);
      const data = res.body.data || res.body;
      expect(res.body.success).toBe(true);
      expect(data).toHaveProperty('previewOtp', '123456');
      expect(data).toHaveProperty('expiresIn', 300);
    });

    it('POST /api/v1/admin/auth/send-otp -> should reject unauthorized domains with 403 Forbidden', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/auth/send-otp')
        .send({ email: unauthorizedEmail });

      expect(res.status).toBe(403);
    });

    it('POST /api/v1/admin/auth/send-otp -> should reject missing email with 400 Bad Request', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/auth/send-otp')
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe('2. Admin OTP Verification & Token Issuance', () => {
    let adminToken: string;

    it('POST /api/v1/admin/auth/verify-otp -> should authenticate valid OTP and issue admin token', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/auth/verify-otp')
        .send({
          email: validAdminEmail,
          otp: '123456',
        });

      expect(res.status).toBe(200);
      const data = res.body.data || res.body;
      expect(res.body.success).toBe(true);
      expect(data).toHaveProperty('adminToken');
      expect(data).toHaveProperty('user');
      expect(data.user.email).toBe(validAdminEmail);
      expect(data.user.role).toBe('SUPER_ADMIN');

      adminToken = data.adminToken;
    });

    it('POST /api/v1/admin/auth/verify-otp -> should reject incorrect OTP with 400 Bad Request', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/auth/verify-otp')
        .send({
          email: validAdminEmail,
          otp: '999999',
        });

      expect(res.status).toBe(400);
    });

    it('POST /api/v1/admin/auth/verify-otp -> should reject unauthorized domain with 403 Forbidden', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/auth/verify-otp')
        .send({
          email: unauthorizedEmail,
          otp: '123456',
        });

      expect(res.status).toBe(403);
    });

    it('POST /api/v1/admin/auth/logout -> should successfully terminate admin session', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/admin/auth/logout')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('3. Admin Business Import Template', () => {
    it('GET /api/v1/admin/template/csv -> should return downloadable CSV template with proper headers', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/template/csv');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('attachment');
      expect(res.text).toContain('cin,pan,gstin,status');
    });
  });
});
