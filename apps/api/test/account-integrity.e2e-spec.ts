import supertest from 'supertest';
const request = (supertest as any).default || supertest;
import { INestApplication } from '@nestjs/common';
import { TestAppHelper } from './helpers/test-app.helper';
import { OAUTH_FIXTURES } from './fixtures/oauth.fixtures';
import { OAuthStateService } from '../src/modules/oauth/services/oauth-state.service';
import { eq } from 'drizzle-orm';
import * as schema from '../src/database/schema';

describe('Sprint 16: Account Integrity & Database Verification (Jest + Supertest)', () => {
  let testApp: TestAppHelper;
  let app: INestApplication;
  let stateService: OAuthStateService;

  const newUserEmail = OAUTH_FIXTURES.google.newUser.profile.email;
  const existingUserEmail = 'integrity.existing.user@orion-test.io';

  beforeAll(async () => {
    testApp = new TestAppHelper();
    app = await testApp.init();
    stateService = app.get<OAuthStateService>(OAuthStateService);

    await testApp.cleanupUsers([newUserEmail, existingUserEmail, OAUTH_FIXTURES.google.existingUserSameEmail.profile.email]);
  });

  afterAll(async () => {
    await testApp.cleanupUsers([newUserEmail, existingUserEmail, OAUTH_FIXTURES.google.existingUserSameEmail.profile.email]);
    await testApp.close();
  });

  describe('1. New OAuth User Database Integrity', () => {
    beforeAll(async () => {
      const { state } = stateService.generateState('GOOGLE');
      await request(app.getHttpServer())
        .post('/api/v1/auth/oauth/token')
        .send({
          provider: 'google',
          code: OAUTH_FIXTURES.google.newUser.code,
          state,
        });
    });

    it('Database -> should have exactly one user record created', async () => {
      const usersFound = await testApp.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, newUserEmail));

      expect(usersFound.length).toBe(1);
      const user = usersFound[0];
      expect(user.googleId).toBe(OAUTH_FIXTURES.google.newUser.profile.providerId);
      expect(user.isEmailVerified).toBe(true);
      expect(user.role).toBe('USER');
      expect(user.status).toBe('ACTIVE');
      expect(user.passwordHash).toBeNull(); // Passwords never exist for OAuth-only users
    });

    it('Database -> should have exactly one wallet with 5 daily credits', async () => {
      const [user] = await testApp.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, newUserEmail));

      const wallets = await testApp.db
        .select()
        .from(schema.userWallets)
        .where(eq(schema.userWallets.userId, user.id));

      expect(wallets.length).toBe(1);
      const wallet = wallets[0];
      expect(wallet.dailyCredits).toBe(5);
      expect(wallet.purchasedCredits).toBe(0);
      expect(wallet.balance).toBe(5);
    });

    it('Database -> should have recorded welcome daily credit transaction', async () => {
      const [user] = await testApp.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, newUserEmail));

      const txs = await testApp.db
        .select()
        .from(schema.creditTransactions)
        .where(eq(schema.creditTransactions.userId, user.id));

      expect(txs.length).toBe(1);
      expect(txs[0].type).toBe('DAILY_ALLOCATION');
      expect(txs[0].amount).toBe(5);
      expect(txs[0].balanceAfter).toBe(5);
    });
  });

  describe('2. Existing User Account Linking Database Integrity', () => {
    let existingUserId: string;
    let initialBalance: number;
    const linkingTargetEmail = OAUTH_FIXTURES.google.existingUserSameEmail.profile.email;

    beforeAll(async () => {
      // 1. Register existing user with email/password
      const reg = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: linkingTargetEmail,
          password: 'Password123!',
          firstName: 'Integrity',
          lastName: 'Existing',
        });
      const regData = reg.body.data || reg.body;
      existingUserId = regData.user.id;

      // 2. Add extra credits and an API key to the user
      const [wallet] = await testApp.db
        .select()
        .from(schema.userWallets)
        .where(eq(schema.userWallets.userId, existingUserId));

      await testApp.db
        .update(schema.userWallets)
        .set({
          purchasedCredits: 50,
          balance: wallet.balance + 50,
        })
        .where(eq(schema.userWallets.id, wallet.id));

      initialBalance = wallet.balance + 50;

      // 3. Create an API key
      await testApp.db.insert(schema.apiKeys).values({
        userId: existingUserId,
        name: 'Integrity Test Key',
        keyPrefix: 'ory_test',
        keyHash: 'hash_of_integrity_key',
        scopes: ['read', 'write'],
      });

      // 4. Now link Google to this existing user via OAuth flow
      const { state } = stateService.generateState('GOOGLE');
      await request(app.getHttpServer())
        .post('/api/v1/auth/oauth/token')
        .send({
          provider: 'google',
          code: OAUTH_FIXTURES.google.existingUserSameEmail.code,
          state,
        });
    });

    it('Database -> existing user count must remain exactly 1 (no duplicate users)', async () => {
      const users = await testApp.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, existingUserId));

      expect(users.length).toBe(1);
      expect(users[0].passwordHash).toBeDefined(); // Password remains intact!
      expect(users[0].googleId).toBe(OAUTH_FIXTURES.google.existingUserSameEmail.profile.providerId);
    });

    it('Database -> existing user must have exactly 1 wallet (no duplicate wallet created)', async () => {
      const wallets = await testApp.db
        .select()
        .from(schema.userWallets)
        .where(eq(schema.userWallets.userId, existingUserId));

      expect(wallets.length).toBe(1);
    });

    it('Database -> existing credits must remain intact and NOT reset', async () => {
      const [wallet] = await testApp.db
        .select()
        .from(schema.userWallets)
        .where(eq(schema.userWallets.userId, existingUserId));

      expect(wallet.purchasedCredits).toBe(50);
      expect(wallet.balance).toBe(initialBalance);
    });

    it('Database -> existing API keys must remain intact', async () => {
      const keys = await testApp.db
        .select()
        .from(schema.apiKeys)
        .where(eq(schema.apiKeys.userId, existingUserId));

      expect(keys.length).toBe(1);
      expect(keys[0].name).toBe('Integrity Test Key');
    });
  });
});
