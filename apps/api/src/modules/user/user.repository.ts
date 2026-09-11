import { Inject, Injectable } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { DRIZZLE_DATABASE } from '../../database/database.constants';
import { DrizzleDb } from '../../database/database.provider';
import * as schema from '../../database/schema';
import { BaseRepository } from '../../common/repositories/base.repository';

@Injectable()
export class UserRepository extends BaseRepository<typeof schema.users> {
  constructor(
    @Inject(DRIZZLE_DATABASE)
    db: DrizzleDb,
  ) {
    super(db, schema.users);
  }

  async findByEmail(email: string) {
    const rows = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email.toLowerCase().trim()))
      .limit(1);

    return rows[0] || null;
  }

  async findByGoogleId(googleId: string) {
    const rows = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.googleId, googleId))
      .limit(1);

    return rows[0] || null;
  }

  async findByMicrosoftId(microsoftId: string) {
    const rows = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.microsoftId, microsoftId))
      .limit(1);

    return rows[0] || null;
  }

  async linkGoogle(userId: string, googleId: string, avatarUrl?: string) {
    const updateData: Partial<typeof schema.users.$inferInsert> = {
      googleId,
      lastLoginProvider: 'GOOGLE',
      lastLoginAt: new Date(),
      emailVerifiedAt: new Date(),
      isEmailVerified: true,
      updatedAt: new Date(),
    };
    if (avatarUrl) {
      updateData.avatarUrl = avatarUrl;
    }

    const [updated] = await this.db
      .update(schema.users)
      .set(updateData)
      .where(eq(schema.users.id, userId))
      .returning();

    return updated;
  }

  async linkMicrosoft(userId: string, microsoftId: string, avatarUrl?: string) {
    const updateData: Partial<typeof schema.users.$inferInsert> = {
      microsoftId,
      lastLoginProvider: 'MICROSOFT',
      lastLoginAt: new Date(),
      emailVerifiedAt: new Date(),
      isEmailVerified: true,
      updatedAt: new Date(),
    };
    if (avatarUrl) {
      updateData.avatarUrl = avatarUrl;
    }

    const [updated] = await this.db
      .update(schema.users)
      .set(updateData)
      .where(eq(schema.users.id, userId))
      .returning();

    return updated;
  }

  async unlinkProvider(userId: string, provider: 'GOOGLE' | 'MICROSOFT') {
    const updateData: Partial<typeof schema.users.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (provider === 'GOOGLE') {
      updateData.googleId = null;
    } else if (provider === 'MICROSOFT') {
      updateData.microsoftId = null;
    }

    const [updated] = await this.db
      .update(schema.users)
      .set(updateData)
      .where(eq(schema.users.id, userId))
      .returning();

    return updated;
  }

  async createRefreshToken(data: {
    userId: string;
    tokenHash: string;
    familyId?: string;
    userAgent?: string;
    ipAddress?: string;
    expiresAt: Date;
  }) {
    const rows = await this.db
      .insert(schema.refreshTokens)
      .values({
        userId: data.userId,
        tokenHash: data.tokenHash,
        familyId: data.familyId,
        userAgent: data.userAgent,
        ipAddress: data.ipAddress,
        expiresAt: data.expiresAt,
      })
      .returning();

    return rows[0];
  }

  async findRefreshToken(tokenHash: string) {
    const rows = await this.db
      .select()
      .from(schema.refreshTokens)
      .where(eq(schema.refreshTokens.tokenHash, tokenHash))
      .limit(1);

    return rows[0] || null;
  }

  async revokeRefreshToken(id: string) {
    await this.db
      .update(schema.refreshTokens)
      .set({ isRevoked: true })
      .where(eq(schema.refreshTokens.id, id));
  }

  async revokeRefreshTokenFamily(familyId: string) {
    await this.db
      .update(schema.refreshTokens)
      .set({ isRevoked: true })
      .where(eq(schema.refreshTokens.familyId, familyId));
  }

  async revokeAllUserRefreshTokens(userId: string) {
    await this.db
      .update(schema.refreshTokens)
      .set({ isRevoked: true })
      .where(eq(schema.refreshTokens.userId, userId));
  }
}
