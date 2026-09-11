import supertest from 'supertest';
const request = (supertest as any).default || supertest;
import { INestApplication } from '@nestjs/common';
import { TestAppHelper } from './helpers/test-app.helper';
import * as jwt from 'jsonwebtoken';

describe('Sprint 16: Authentication E2E Tests (Jest + Supertest)', () => {
  let testApp: TestAppHelper;
  let app: INestApplication;

  const testEmail = 'sprint16.auth.tester@orion-test.io';
  const testPassword = 'SecurePassword123!';

  beforeAll(async () => {
    testApp = new TestAppHelper();
    app = await testApp.init();
    await testApp.cleanupUsers([testEmail, 'invalid.refresh@orion-test.io']);
  });

  afterAll(async () => {
    await testApp.cleanupUsers([testEmail, 'invalid.refresh@orion-test.io']);
    await testApp.close();
  });

  describe('1. Registration Flow', () => {
    it('POST /api/v1/auth/register -> should successfully register a new user', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: testEmail,
          password: testPassword,
          firstName: 'Sprint16',
          lastName: 'Tester',
        });

      expect(res.status).toBe(201);
      const data = res.body.data || res.body;
      expect(data).toHaveProperty('user');
      expect(data).toHaveProperty('tokens');
      expect(data.user.email).toBe(testEmail);
      expect(data.user.role).toBe('USER');
      expect(data.user.status).toBe('ACTIVE');
      expect(data.tokens.accessToken).toBeDefined();
      expect(data.tokens.refreshToken).toBeDefined();
      // Ensure password hash is NEVER leaked
      expect(data.user.passwordHash).toBeUndefined();
      expect(data.user.password).toBeUndefined();
    });

    it('POST /api/v1/auth/register -> should reject duplicate registration with 409 Conflict', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: testEmail,
          password: testPassword,
          firstName: 'Duplicate',
          lastName: 'User',
        });

      expect(res.status).toBe(409);
      expect(res.body.errorCode).toBe('EMAIL_ALREADY_EXISTS');
    });

    it('POST /api/v1/auth/register -> should reject invalid email format with 400 Bad Request', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: 'not-an-email',
          password: testPassword,
          firstName: 'Bad',
          lastName: 'Email',
        });

      expect(res.status).toBe(400);
    });
  });

  describe('2. Login & Token Issuance', () => {
    let accessToken: string;
    let refreshToken: string;

    it('POST /api/v1/auth/login -> should authenticate valid user credentials and issue tokens', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: testEmail,
          password: testPassword,
        });

      expect(res.status).toBe(200);
      const data = res.body.data || res.body;
      expect(data.user.email).toBe(testEmail);
      expect(data.tokens.accessToken).toBeDefined();
      expect(data.tokens.refreshToken).toBeDefined();

      accessToken = data.tokens.accessToken;
      refreshToken = data.tokens.refreshToken;

      // Verify JWT payload structure
      const decoded: any = jwt.decode(accessToken);
      expect(decoded.sub).toBe(data.user.id);
      expect(decoded.email).toBe(testEmail);
      expect(decoded.role).toBe('USER');
      expect(decoded.status).toBe('ACTIVE');
    });

    it('POST /api/v1/auth/login -> should reject invalid password with 401 Unauthorized', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: testEmail,
          password: 'WrongPassword999!',
        });

      expect(res.status).toBe(401);
    });

    it('POST /api/v1/auth/login -> should reject nonexistent user with 401 Unauthorized', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: 'nonexistent.user@orion-test.io',
          password: 'AnyPassword123!',
        });

      expect(res.status).toBe(401);
    });
  });

  describe('3. Protected Endpoints & Authorization Guards', () => {
    let validToken: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: testEmail, password: testPassword });
      const data = res.body.data || res.body;
      validToken = data.tokens.accessToken;
    });

    it('GET /api/v1/auth/me -> should succeed with valid Bearer token', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${validToken}`);

      expect(res.status).toBe(200);
      const data = res.body.data || res.body;
      expect(data.email).toBe(testEmail);
      expect(data.wallet).toBeDefined();
      expect(data.wallet.balance).toBeGreaterThanOrEqual(5);
    });

    it('GET /api/v1/auth/me -> should reject request without Authorization header with 401', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/auth/me');
      expect(res.status).toBe(401);
    });

    it('GET /api/v1/auth/me -> should reject invalid / forged Bearer token with 401', async () => {
      const forgedToken = jwt.sign(
        { sub: 'random-uuid', email: 'hacker@test.com', role: 'ADMIN' },
        'wrong-secret-key-signature',
      );

      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${forgedToken}`);

      expect(res.status).toBe(401);
    });

    it('GET /api/v1/auth/me -> should reject malformed Bearer format with 401', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', 'NotBearerToken12345');

      expect(res.status).toBe(401);
    });
  });

  describe('4. Refresh Token & Session Rotation', () => {
    let activeRefreshToken: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: testEmail, password: testPassword });
      const data = res.body.data || res.body;
      activeRefreshToken = data.tokens.refreshToken;
    });

    it('POST /api/v1/auth/refresh -> should issue a new token pair using valid refresh token', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: activeRefreshToken });

      expect(res.status).toBe(200);
      const data = res.body.data || res.body;
      expect(data.accessToken).toBeDefined();
      expect(data.refreshToken).toBeDefined();
      expect(data.refreshToken).not.toBe(activeRefreshToken);

      // Save newly rotated refresh token
      activeRefreshToken = data.refreshToken;
    });

    it('POST /api/v1/auth/refresh -> should reject malformed or nonexistent refresh token with 401', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'completely-invalid-refresh-token' });

      expect(res.status).toBe(401);
    });
  });

  describe('5. Logout & Session Revocation', () => {
    let sessionAccessToken: string;
    let sessionRefreshToken: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: testEmail, password: testPassword });
      const data = res.body.data || res.body;
      sessionAccessToken = data.tokens.accessToken;
      sessionRefreshToken = data.tokens.refreshToken;
    });

    it('POST /api/v1/auth/logout -> should revoke the session and refresh token', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${sessionAccessToken}`)
        .send({ refreshToken: sessionRefreshToken });

      expect(res.status).toBe(200);

      // Attempting to refresh with the revoked token must fail with 401
      const refreshRes = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: sessionRefreshToken });

      expect(refreshRes.status).toBe(401);
    });
  });
});
