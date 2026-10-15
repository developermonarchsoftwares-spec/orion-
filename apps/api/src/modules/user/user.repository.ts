import { Inject, Injectable } from '@nestjs/common';
import { eq, and, gt, isNull, lt, or, desc, sql } from 'drizzle-orm';
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

  async revokeRefreshToken(id: string, reason = 'ROTATED') {
    const rows = await this.db
      .update(schema.refreshTokens)
      .set({ isRevoked: true, revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(schema.refreshTokens.id, id), eq(schema.refreshTokens.isRevoked, false)))
      .returning({ id: schema.refreshTokens.id });
    return rows.length > 0;
  }

  async revokeRefreshTokenFamily(familyId: string, reason = 'REUSE_DETECTED') {
    await this.db
      .update(schema.refreshTokens)
      .set({ isRevoked: true, revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(schema.refreshTokens.familyId, familyId), eq(schema.refreshTokens.isRevoked, false)));
  }

  /** Revokes the family only when it belongs to the user. Returns the number of tokens revoked. */
  async revokeUserSession(userId: string, familyId: string, reason = 'USER_REVOKED') {
    const rows = await this.db
      .update(schema.refreshTokens)
      .set({ isRevoked: true, revokedAt: new Date(), revokedReason: reason })
      .where(
        and(
          eq(schema.refreshTokens.userId, userId),
          eq(schema.refreshTokens.familyId, familyId),
          eq(schema.refreshTokens.isRevoked, false),
        ),
      )
      .returning({ id: schema.refreshTokens.id });
    return rows.length;
  }

  async revokeAllUserRefreshTokens(userId: string, reason = 'REVOKE_ALL') {
    await this.db
      .update(schema.refreshTokens)
      .set({ isRevoked: true, revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(schema.refreshTokens.userId, userId), eq(schema.refreshTokens.isRevoked, false)));
  }

  /** One row per live session (token family): its newest un-revoked, un-expired refresh token. */
  async listActiveSessions(userId: string) {
    return this.db
      .select({
        familyId: schema.refreshTokens.familyId,
        userAgent: schema.refreshTokens.userAgent,
        ipAddress: schema.refreshTokens.ipAddress,
        createdAt: schema.refreshTokens.createdAt,
        expiresAt: schema.refreshTokens.expiresAt,
      })
      .from(schema.refreshTokens)
      .where(
        and(
          eq(schema.refreshTokens.userId, userId),
          eq(schema.refreshTokens.isRevoked, false),
          gt(schema.refreshTokens.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(schema.refreshTokens.createdAt));
  }

  /** Deletes expired tokens and revoked ones older than `revokedRetentionMs` (kept briefly for reuse detection). */
  async purgeRefreshTokens(revokedRetentionMs: number) {
    const cutoff = new Date(Date.now() - revokedRetentionMs);
    const rows = await this.db
      .delete(schema.refreshTokens)
      .where(
        or(
          lt(schema.refreshTokens.expiresAt, new Date()),
          and(eq(schema.refreshTokens.isRevoked, true), lt(schema.refreshTokens.revokedAt, cutoff)),
        ),
      )
      .returning({ id: schema.refreshTokens.id });
    return rows.length;
  }

  // ---- single-use action tokens (password reset / email verification) ----

  /** Replaces any outstanding token of the same purpose, so only the newest link works. */
  async createActionToken(userId: string, purpose: string, tokenHash: string, expiresAt: Date) {
    await this.db
      .delete(schema.authActionTokens)
      .where(and(eq(schema.authActionTokens.userId, userId), eq(schema.authActionTokens.purpose, purpose), isNull(schema.authActionTokens.usedAt)));
    await this.db.insert(schema.authActionTokens).values({ userId, purpose, tokenHash, expiresAt });
  }

  /** Atomically marks the token used and returns it; null when unknown, used, expired or of another purpose. */
  async consumeActionToken(purpose: string, tokenHash: string) {
    const rows = await this.db
      .update(schema.authActionTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(schema.authActionTokens.tokenHash, tokenHash),
          eq(schema.authActionTokens.purpose, purpose),
          isNull(schema.authActionTokens.usedAt),
          gt(schema.authActionTokens.expiresAt, new Date()),
        ),
      )
      .returning();
    return rows[0] || null;
  }

  async purgeActionTokens() {
    await this.db.delete(schema.authActionTokens).where(lt(schema.authActionTokens.expiresAt, new Date(Date.now() - 24 * 60 * 60 * 1000)));
  }

  // ---- MFA recovery codes ----

  async replaceRecoveryCodes(userId: string, codeHashes: string[]) {
    await this.db.delete(schema.userRecoveryCodes).where(eq(schema.userRecoveryCodes.userId, userId));
    if (codeHashes.length) {
      await this.db.insert(schema.userRecoveryCodes).values(codeHashes.map((codeHash) => ({ userId, codeHash })));
    }
  }

  /**
   * Atomically records an accepted TOTP time-step. Only the one caller whose step is newer than the stored mfaLastStep wins, so two
   * concurrent requests carrying the same code cannot both pass (a read-then-write check would let both through).
   */
  async claimTotpStep(userId: string, step: number): Promise<boolean> {
    const rows = await this.db
      .update(schema.users)
      .set({
        metadata: sql`jsonb_set(coalesce(${schema.users.metadata}, '{}'::jsonb), '{mfaLastStep}', to_jsonb(${step}::bigint))`,
      })
      .where(
        and(
          eq(schema.users.id, userId),
          sql`((coalesce(${schema.users.metadata}, '{}'::jsonb) ->> 'mfaLastStep') is null or (${schema.users.metadata} ->> 'mfaLastStep')::bigint < ${step}::bigint)`,
        ),
      )
      .returning({ id: schema.users.id });
    return rows.length > 0;
  }

  async consumeRecoveryCode(userId: string, codeHash: string) {
    const rows = await this.db
      .update(schema.userRecoveryCodes)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(schema.userRecoveryCodes.userId, userId),
          eq(schema.userRecoveryCodes.codeHash, codeHash),
          isNull(schema.userRecoveryCodes.usedAt),
        ),
      )
      .returning({ id: schema.userRecoveryCodes.id });
    return rows.length > 0;
  }

  async countUnusedRecoveryCodes(userId: string) {
    const rows = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.userRecoveryCodes)
      .where(and(eq(schema.userRecoveryCodes.userId, userId), isNull(schema.userRecoveryCodes.usedAt)));
    return Number(rows[0]?.n ?? 0);
  }
}
