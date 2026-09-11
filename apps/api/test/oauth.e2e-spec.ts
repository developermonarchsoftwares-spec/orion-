import supertest from 'supertest';
const request = (supertest as any).default || supertest;
import { INestApplication } from '@nestjs/common';
import { TestAppHelper } from './helpers/test-app.helper';
import { OAUTH_FIXTURES } from './fixtures/oauth.fixtures';
import { OAuthStateService } from '../src/modules/oauth/services/oauth-state.service';
import { eq } from 'drizzle-orm';
import * as schema from '../src/database/schema';

describe('Sprint 16: OAuth & Enterprise Identity E2E Tests (Jest + Supertest)', () => {
  let testApp: TestAppHelper;
  let app: INestApplication;
  let stateService: OAuthStateService;

  const googleNewEmail = OAUTH_FIXTURES.google.newUser.profile.email;
  const googleExistingEmail = OAUTH_FIXTURES.google.existingUserSameEmail.profile.email;
  const msNewEmail = OAUTH_FIXTURES.microsoft.newUser.profile.email;
  const msExistingEmail = OAUTH_FIXTURES.microsoft.existingUserSameEmail.profile.email;

  beforeAll(async () => {
    testApp = new TestAppHelper();
    app = await testApp.init();
    stateService = app.get<OAuthStateService>(OAuthStateService);

    // Clean up test users
    await testApp.cleanupUsers([
      googleNewEmail,
      googleExistingEmail,
      msNewEmail,
      msExistingEmail,
      'google.unlink.tester@orion-test.io',
      'oauth.only.tester@orion-test.io',
    ]);

    // Pre-create an email/password user for testing automatic account linking
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: googleExistingEmail,
        password: 'Password123!',
        firstName: 'Existing',
        lastName: 'EmailUser',
      });

    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: msExistingEmail,
        password: 'Password123!',
        firstName: 'Existing',
        lastName: 'MsUser',
      });
  });

  afterAll(async () => {
    await testApp.cleanupUsers([
      googleNewEmail,
      googleExistingEmail,
      msNewEmail,
      msExistingEmail,
      'google.unlink.tester@orion-test.io',
      'oauth.only.tester@orion-test.io',
    ]);
    await testApp.close();
  });

  describe('1. Google OAuth Flow', () => {
    it('GET /api/v1/auth/google -> should generate correct authorization redirect with PKCE', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/auth/google');
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('https://accounts.google.com/o/oauth2/v2/auth');
      expect(res.headers.location).toContain('client_id=');
      expect(res.headers.location).toContain('redirect_uri=');
      expect(res.headers.location).toContain('state=');
      expect(res.headers.location).toContain('code_challenge=');
      expect(res.headers.location).toContain('code_challenge_method=S256');
    });

    it('GET /api/v1/auth/google/callback -> should redirect to login when user cancels with ?error', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/google/callback?error=access_denied');

      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('/login?error=');
      expect(res.headers.location).toContain(encodeURIComponent('Google sign-in was cancelled or denied.'));
    });

    it('GET /api/v1/auth/google/callback -> should reject missing state with error redirect', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/google/callback?code=some-code');

      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('/login?error=');
    });

    it('GET /api/v1/auth/google/callback -> should reject tampered / invalid state with error redirect', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/google/callback?code=some-code&state=tampered.invalid.state');

      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('/login?error=');
    });

    it('GET /api/v1/auth/google/callback -> should reject missing authorization code with error redirect', async () => {
      const { state } = stateService.generateState('GOOGLE');
      const res = await request(app.getHttpServer())
        .get(`/api/v1/auth/google/callback?state=${state}`);

      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('/login?error=');
    });

    it('POST /api/v1/auth/oauth/token -> should authenticate brand new Google user', async () => {
      const { state } = stateService.generateState('GOOGLE');
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/oauth/token')
        .send({
          provider: 'google',
          code: OAUTH_FIXTURES.google.newUser.code,
          state,
        });

      expect(res.status).toBe(200);
      const data = res.body.data || res.body;
      expect(data.user.email).toBe(googleNewEmail);
      expect(data.user.googleLinked).toBe(true);
      expect(data.isNewUser).toBe(true);
      expect(data.tokens.accessToken).toBeDefined();
      expect(data.tokens.refreshToken).toBeDefined();
    });

    it('POST /api/v1/auth/oauth/token -> should prevent OAuth state replay attacks', async () => {
      const { state } = stateService.generateState('GOOGLE');

      // First call consumes state successfully
      const firstRes = await request(app.getHttpServer())
        .post('/api/v1/auth/oauth/token')
        .send({
          provider: 'google',
          code: OAUTH_FIXTURES.google.newUser.code,
          state,
        });
      expect(firstRes.status).toBe(200);

      // Replaying the exact same state MUST fail
      const replayRes = await request(app.getHttpServer())
        .post('/api/v1/auth/oauth/token')
        .send({
          provider: 'google',
          code: OAUTH_FIXTURES.google.newUser.code,
          state,
        });
      expect(replayRes.status).toBe(400);
      expect(replayRes.body.errorCode).toBe('INVALID_OAUTH_STATE');
    });

    it('POST /api/v1/auth/oauth/token -> should link Google account to existing user with same email', async () => {
      const { state } = stateService.generateState('GOOGLE');
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/oauth/token')
        .send({
          provider: 'google',
          code: OAUTH_FIXTURES.google.existingUserSameEmail.code,
          state,
        });

      expect(res.status).toBe(200);
      const data = res.body.data || res.body;
      expect(data.user.email).toBe(googleExistingEmail);
      expect(data.user.googleLinked).toBe(true);
      expect(data.user.hasPassword).toBe(true); // Pre-existing password preserved!
      expect(data.linkedExisting).toBe(true);
      expect(data.isNewUser).toBe(false);
    });
  });

  describe('2. Microsoft Entra ID OAuth Flow', () => {
    it('GET /api/v1/auth/microsoft -> should generate correct authorization redirect', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/auth/microsoft');
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('login.microsoftonline.com');
      expect(res.headers.location).toContain('client_id=');
      expect(res.headers.location).toContain('redirect_uri=');
      expect(res.headers.location).toContain('state=');
    });

    it('GET /api/v1/auth/microsoft/callback -> should redirect to login when cancelled with ?error', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/microsoft/callback?error=access_denied');

      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('/login?error=');
      expect(res.headers.location).toContain(encodeURIComponent('Microsoft sign-in was cancelled or denied.'));
    });

    it('POST /api/v1/auth/oauth/token -> should authenticate brand new Microsoft user', async () => {
      const { state } = stateService.generateState('MICROSOFT');
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/oauth/token')
        .send({
          provider: 'microsoft',
          code: OAUTH_FIXTURES.microsoft.newUser.code,
          state,
        });

      expect(res.status).toBe(200);
      const data = res.body.data || res.body;
      expect(data.user.email).toBe(msNewEmail);
      expect(data.user.microsoftLinked).toBe(true);
      expect(data.isNewUser).toBe(true);
      expect(data.tokens.accessToken).toBeDefined();
      expect(data.tokens.refreshToken).toBeDefined();
    });

    it('POST /api/v1/auth/oauth/token -> should link Microsoft account to existing user with same email', async () => {
      const { state } = stateService.generateState('MICROSOFT');
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/oauth/token')
        .send({
          provider: 'microsoft',
          code: OAUTH_FIXTURES.microsoft.existingUserSameEmail.code,
          state,
        });

      expect(res.status).toBe(200);
      const data = res.body.data || res.body;
      expect(data.user.email).toBe(msExistingEmail);
      expect(data.user.microsoftLinked).toBe(true);
      expect(data.user.hasPassword).toBe(true);
      expect(data.linkedExisting).toBe(true);
    });
  });

  describe('3. OAuth Security & Account Unlinking', () => {
    let unlinkToken: string;
    const unlinkUserEmail = 'google.unlink.tester@orion-test.io';

    beforeAll(async () => {
      // Create user with password and link Google
      const reg = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: unlinkUserEmail,
          password: 'Password123!',
          firstName: 'Unlink',
          lastName: 'Tester',
        });
      const data = reg.body.data || reg.body;
      unlinkToken = data.tokens.accessToken;

      // Link Google identity
      const [u] = await testApp.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, unlinkUserEmail));

      await testApp.db
        .update(schema.users)
        .set({ googleId: 'google-unlink-id-999' })
        .where(eq(schema.users.id, u.id));
    });

    it('POST /api/v1/auth/unlink-provider -> should unlink Google provider when password exists', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/unlink-provider')
        .set('Authorization', `Bearer ${unlinkToken}`)
        .send({ provider: 'google' });

      expect(res.status).toBe(200);
      const data = res.body.data || res.body;
      expect(data.success).toBe(true);

      // Verify Google ID removed in database
      const [u] = await testApp.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, unlinkUserEmail));
      expect(u.googleId).toBeNull();
    });

    it('POST /api/v1/auth/unlink-provider -> should reject unlinking only login method without password', async () => {
      // Create an OAuth-only user (no password)
      const { state } = stateService.generateState('GOOGLE');
      const oauthRes = await request(app.getHttpServer())
        .post('/api/v1/auth/oauth/token')
        .send({
          provider: 'google',
          code: 'oauth-only-code-abc',
          state,
        });

      const data = oauthRes.body.data || oauthRes.body;
      const oauthToken = data.tokens.accessToken;

      const unlinkRes = await request(app.getHttpServer())
        .post('/api/v1/auth/unlink-provider')
        .set('Authorization', `Bearer ${oauthToken}`)
        .send({ provider: 'google' });

      expect(unlinkRes.status).toBe(400);
      expect(unlinkRes.body.errorCode).toBe('CANNOT_UNLINK_ONLY_PROVIDER');
    });

    it('POST /api/v1/auth/oauth/token -> should reject provider mismatch', async () => {
      // State generated for GOOGLE, but submitted to MICROSOFT
      const { state } = stateService.generateState('GOOGLE');

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/oauth/token')
        .send({
          provider: 'microsoft',
          code: 'some-code',
          state,
        });

      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe('PROVIDER_MISMATCH');
    });

    it('Security -> sensitive OAuth client secrets or token hashes must NEVER appear in response', async () => {
      const { state } = stateService.generateState('GOOGLE');
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/oauth/token')
        .send({
          provider: 'google',
          code: OAUTH_FIXTURES.google.newUser.code,
          state,
        });

      const responseText = JSON.stringify(res.body);
      expect(responseText).not.toContain('clientSecret');
      expect(responseText).not.toContain('GOOGLE_CLIENT_SECRET');
      expect(responseText).not.toContain('tokenHash');
      expect(responseText).not.toContain('passwordHash');
    });
  });
});
