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

export class TestAppHelper {
  app: INestApplication;
  module: TestingModule;
  db: DrizzleDb;
  pool: Pool;

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

    return this.app;
  }

  async cleanupUsers(emails: string[]): Promise<void> {
    if (!emails.length) return;

    try {
      // Delete any admin OTPs for these emails
      await this.db
        .delete(schema.adminOtps)
        .where(inArray(schema.adminOtps.email, emails));

      const usersFound = await this.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(inArray(schema.users.email, emails));

      const userIds = usersFound.map((u) => u.id);

      if (userIds.length > 0) {
        // Delete lead unlocks
        await this.db
          .delete(schema.leadUnlocks)
          .where(inArray(schema.leadUnlocks.userId, userIds));

        // Delete saved leads
        await this.db
          .delete(schema.savedLeads)
          .where(inArray(schema.savedLeads.userId, userIds));

        // Delete saved searches
        await this.db
          .delete(schema.savedSearches)
          .where(inArray(schema.savedSearches.userId, userIds));

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
      console.warn(`[TestAppHelper] User Cleanup warning: ${err.message}`);
    }
  }

  async createTestBusiness(params: {
    slug: string;
    name: string;
    contactEmail: string;
    contactPhone: string;
    city?: string;
    state?: string;
  }) {
    // 1. Insert business
    const [biz] = await this.db
      .insert(schema.businesses)
      .values({
        slug: params.slug,
        name: params.name,
        legalName: `${params.name} Pvt Ltd`,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        employeeCountRange: '50-200',
        annualRevenueRange: '10M-50M',
      })
      .returning();

    // 2. Insert primary location
    await this.db.insert(schema.businessLocations).values({
      businessId: biz.id,
      addressLine1: '42 Cyber City Tower 3',
      city: params.city || 'Bangalore',
      district: params.city || 'Bangalore',
      state: params.state || 'Karnataka',
      pincode: '560001',
      country: 'India',
      isPrimary: true,
    });

    // 3. Insert primary contact
    await this.db.insert(schema.businessContacts).values({
      businessId: biz.id,
      fullName: 'Vikram Aditya Sharma',
      title: 'Chief Technology Officer',
      email: params.contactEmail,
      phone: params.contactPhone,
      isPrimary: true,
      isDecisionMaker: true,
    });

    return biz;
  }

  async cleanupBusinesses(slugs: string[]): Promise<void> {
    if (!slugs.length) return;
    try {
      const found = await this.db
        .select({ id: schema.businesses.id })
        .from(schema.businesses)
        .where(inArray(schema.businesses.slug, slugs));

      const bizIds = found.map((b) => b.id);
      if (bizIds.length > 0) {
        await this.db.delete(schema.leadUnlocks).where(inArray(schema.leadUnlocks.businessId, bizIds));
        await this.db.delete(schema.savedLeads).where(inArray(schema.savedLeads.businessId, bizIds));
        await this.db.delete(schema.businessContacts).where(inArray(schema.businessContacts.businessId, bizIds));
        await this.db.delete(schema.businessLocations).where(inArray(schema.businessLocations.businessId, bizIds));
        await this.db.delete(schema.businesses).where(inArray(schema.businesses.id, bizIds));
      }
    } catch (err: any) {
      console.warn(`[TestAppHelper] Business Cleanup warning: ${err.message}`);
    }
  }

  async close(): Promise<void> {
    if (this.app) {
      await this.app.close();
    }
    if (this.pool) {
      try {
        await this.pool.end();
      } catch {}
    }
  }
}
