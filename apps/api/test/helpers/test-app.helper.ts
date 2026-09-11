import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { GoogleOAuthProvider } from '../../src/modules/oauth/providers/google.provider';
import { MicrosoftOAuthProvider } from '../../src/modules/oauth/providers/microsoft.provider';
import { MockGoogleOAuthProvider, MockMicrosoftOAuthProvider } from '../mocks/mock-oauth-providers';
import { DRIZZLE_DATABASE, PG_POOL } from '../../src/database/database.constants';
import { DrizzleDb } from '../../src/database/database.provider';
import * as schema from '../../src/database/schema';
import { inArray, eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { REDIS_CLIENT } from '../../src/modules/redis/redis.constants';
import Redis from 'ioredis';

export class TestAppHelper {
  app: INestApplication;
  module: TestingModule;
  db: DrizzleDb;
  pool: Pool;
  redis: Redis;

  async init(): Promise<INestApplication> {
    this.module = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(GoogleOAuthProvider)
      .useClass(MockGoogleOAuthProvider)
      .overrideProvider(MicrosoftOAuthProvider)
      .useClass(MockMicrosoftOAuthProvider)
      .compile();

    this.app = this.module.createNestApplication();

    // Set Global Prefix to match production main.ts
    this.app.setGlobalPrefix('api/v1');

    // Set ValidationPipe to match production main.ts
    this.app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: {
          enableImplicitConversion: true,
        },
      }),
    );

    await this.app.init();

    this.db = this.app.get<DrizzleDb>(DRIZZLE_DATABASE);
    this.pool = this.app.get<Pool>(PG_POOL);
    this.redis = this.app.get<Redis>(REDIS_CLIENT);

    return this.app;
  }

  async cleanupUsers(emails: string[]): Promise<void> {
    if (!emails.length) return;

    try {
      const usersFound = await this.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(inArray(schema.users.email, emails));

      const userIds = usersFound.map((u) => u.id);

      if (userIds.length > 0) {
        // Delete audit logs associated with these users
        await this.db
          .delete(schema.auditLogs)
          .where(inArray(schema.auditLogs.userId, userIds));

        // Delete credit transactions
        await this.db
          .delete(schema.creditTransactions)
          .where(inArray(schema.creditTransactions.userId, userIds));

        // Delete user wallets
        await this.db
          .delete(schema.userWallets)
          .where(inArray(schema.userWallets.userId, userIds));

        // Delete refresh tokens
        await this.db
          .delete(schema.refreshTokens)
          .where(inArray(schema.refreshTokens.userId, userIds));

        // Delete api keys
        await this.db
          .delete(schema.apiKeys)
          .where(inArray(schema.apiKeys.userId, userIds));

        // Delete users
        await this.db
          .delete(schema.users)
          .where(inArray(schema.users.id, userIds));
      }
    } catch (err: any) {
      console.warn(`[TestAppHelper] Cleanup warning: ${err.message}`);
    }
  }

  async close(): Promise<void> {
    if (this.app) {
      await this.app.close();
    }
    if (this.redis) {
      try {
        this.redis.disconnect();
      } catch {}
    }
    if (this.pool) {
      try {
        await this.pool.end();
      } catch {}
    }
  }
}
