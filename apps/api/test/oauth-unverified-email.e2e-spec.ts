import supertest from 'supertest';
const request = (supertest as any).default || supertest;
import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { eq } from 'drizzle-orm';
import { TestAppHelper } from './helpers/test-app.helper';
import { OAuthStateService } from '../src/modules/oauth/services/oauth-state.service';
import * as schema from '../src/database/schema';
import { UNVERIFIED_GOOGLE_CODE, UNVERIFIED_GOOGLE_EMAIL } from './mocks/mock-oauth-providers';

/**
 * SG-03 over HTTP (Phase 32). The rule "a provider e-mail that is not verified can neither sign in nor link" was tested only in a unit
 * test with mocked repositories; removing the check left the whole e2e OAuth suite green. This is the account-takeover scenario on the
 * real application: an attacker controls a provider account that CLAIMS the victim's address without having verified it.
 */
describe('OAuth with an unverified provider e-mail (SG-03)', () => {
  let testApp: TestAppHelper;
  let app: INestApplication;
  let stateService: OAuthStateService;
  const api = () => request(app.getHttpServer());
  const exchange = () => {
    const { state } = stateService.generateState('GOOGLE');
    return api().post('/api/v1/auth/oauth/token').send({ provider: 'google', code: UNVERIFIED_GOOGLE_CODE, state });
  };
  const usersWithEmail = () => (testApp.db as any).select().from(schema.users).where(eq(schema.users.email, UNVERIFIED_GOOGLE_EMAIL));

  beforeAll(async () => {
    testApp = new TestAppHelper();
    app = await testApp.init();
    stateService = app.get<OAuthStateService>(OAuthStateService);
    await testApp.cleanupUsers([UNVERIFIED_GOOGLE_EMAIL]);
  });
  beforeEach(() => {
    (app.get(ThrottlerStorage) as any).storage.clear();
  });
  afterAll(async () => {
    await testApp.cleanupUsers([UNVERIFIED_GOOGLE_EMAIL]);
    await testApp.close();
  });

  it('refuses to create an account for an unverified provider e-mail and issues no tokens', async () => {
    const res = await exchange();
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toContain('OAUTH_EMAIL_UNVERIFIED');
    expect(JSON.stringify(res.body)).not.toMatch(/accessToken|refreshToken/);
    expect(await usersWithEmail()).toHaveLength(0);
  });

  it('refuses to link to, or sign in as, an existing account that holds that address, and changes nothing on it', async () => {
    const reg = await api().post('/api/v1/auth/register').send({ email: UNVERIFIED_GOOGLE_EMAIL, password: 'VictimPass123!', firstName: 'Vic', lastName: 'Tim' });
    expect([200, 201]).toContain(reg.status);
    (app.get(ThrottlerStorage) as any).storage.clear();
    const before = (await usersWithEmail())[0];

    const res = await exchange();
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toContain('OAUTH_EMAIL_UNVERIFIED');
    expect(JSON.stringify(res.body)).not.toMatch(/accessToken|refreshToken/);

    const after = await usersWithEmail();
    expect(after).toHaveLength(1);
    expect(after[0].googleId ?? null).toBeNull(); // the attacker's provider identity was NOT attached to the victim
    expect(after[0].id).toBe(before.id);
    expect(after[0].passwordHash).toBe(before.passwordHash);
  });
});
