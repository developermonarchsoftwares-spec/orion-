import supertest from 'supertest';
const request = (supertest as any).default || supertest;
import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { TestAppHelper } from './helpers/test-app.helper';

/**
 * SG-25 over HTTP: the global validation pipe applies the 128-character password cap before any hashing happens.
 * Only refusals are tested here, so no account is created and nothing needs cleaning up.
 */
describe('Password length limit at the HTTP boundary (SG-25)', () => {
  let testApp: TestAppHelper;
  let app: INestApplication;
  const api = () => request(app.getHttpServer());
  const long = 'Aa1!'.repeat(33); // 132 characters

  beforeAll(async () => {
    testApp = new TestAppHelper();
    app = await testApp.init();
  });
  beforeEach(() => {
    (app.get(ThrottlerStorage) as any).storage.clear();
  });
  afterAll(async () => {
    await testApp.close();
  });

  it('registration with an over-long password is refused with a validation error and names no secret', async () => {
    const res = await api().post('/api/v1/auth/register').send({ email: `long.${Date.now()}@orion-test.io`, password: long, firstName: 'Lo', lastName: 'Ng' });
    expect(res.status).toBe(400);
    const text = JSON.stringify(res.body);
    expect(text).toMatch(/must not exceed 128/i);
    expect(text).not.toContain(long);
  });

  it('password reset with an over-long new password is refused before the token is looked at', async () => {
    const res = await api().post('/api/v1/auth/reset-password').send({ token: 'not-a-real-token', newPassword: long });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/must not exceed 128/i);
  });

  it('changing a password with an over-long value is refused for a signed-in user', async () => {
    const email = `chg.${Date.now()}@orion-test.io`;
    const created = await api().post('/api/v1/auth/register').send({ email, password: 'ValidPass123!', firstName: 'Ch', lastName: 'Pw' });
    const body = created.body.data || created.body;
    try {
      const auth = { Authorization: `Bearer ${body.tokens.accessToken}` };
      const res = await api().post('/api/v1/user/change-password').set(auth).send({ currentPassword: 'ValidPass123!', newPassword: long });
      expect([400, 404]).toContain(res.status); // 404 only if the route is named differently; the DTO unit test covers the rule itself
      if (res.status === 404) throw new Error('change-password route not found: update this test');
    } finally {
      await testApp.cleanupUsers([email]);
    }
  });
});
