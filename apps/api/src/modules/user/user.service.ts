import { Injectable, Logger, HttpStatus, Inject, forwardRef, Optional } from '@nestjs/common';
import { UserRepository } from './user.repository';
import { UpdateProfileDto, ChangePasswordDto, UpdateUserSettingsDto } from './dto/user.dto';
import { PasswordService } from '../../auth/services/password.service';
import { CreditService } from '../credit/credit.service';
import { BusinessException } from '../../common/errors/business.exception';
import { DRIZZLE_DATABASE } from '../../database/database.constants';
import { DrizzleDb } from '../../database/database.provider';
import * as schema from '../../database/schema';
import { AuditLogService } from '../../common/services/audit-log.service';
import { eq } from 'drizzle-orm';
import { validateAvatarImage } from '../../common/utils/avatar-validation.util';

/** The settings a customer may write through PATCH /user/settings (same keys the web gateway allows), with their types. */
export const USER_SETTING_KEYS: Readonly<Record<string, 'boolean' | 'string'>> = Object.freeze({
  emailNewBusinesses: 'boolean',
  savedSearchAlerts: 'boolean',
  creditLowWarning: 'boolean',
  weeklyDigest: 'boolean',
  productUpdates: 'boolean',
  marketingEmails: 'boolean',
  resultsPerPage: 'string',
  defaultView: 'string',
  timezone: 'string',
  dateFormat: 'string',
});
const MAX_USER_SETTING_STRING = 120;

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    private readonly userRepo: UserRepository,
    private readonly passwordService: PasswordService,
    @Inject(forwardRef(() => CreditService))
    private readonly creditService: CreditService,
    @Inject(DRIZZLE_DATABASE)
    private readonly db: DrizzleDb,
    @Optional() private readonly auditLog?: AuditLogService,
  ) {}

  /**
   * Retrieves sanitized profile of current authenticated user
   */
  async getProfile(userId: string) {
    const user = await this.userRepo.findById(userId);
    if (!user) {
      throw new BusinessException('User not found', 'USER_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    // Ensure wallet exists, sync daily rollover, and get accurate balance from database
    let wallet: any;
    try {
      wallet = await this.creditService.getWallet(userId);
    } catch {
      const walletRows = await this.db
        .select()
        .from(schema.userWallets)
        .where(eq(schema.userWallets.userId, userId))
        .limit(1);
      wallet = walletRows[0] || { balance: 5, dailyCredits: 5, purchasedCredits: 0, lifetimePurchased: 0, lifetimeUsed: 0 };
    }

    // Phase 10: besides the secrets, the free-form metadata, the erasure marker and the identity-provider subject ids are not part of the profile
    // response (jobTitle and the linked flags below carry what the client needs).
    const { passwordHash, twoFactorSecret, metadata: _metadata, deletedAt: _deletedAt, googleId: _googleId, microsoftId: _microsoftId, providerId: _providerId, ...sanitized } = user;
    const metadata = (user.metadata as Record<string, any>) || {};
    const name = user.displayName || `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email.split('@')[0];

    return {
      ...sanitized,
      name,
      displayName: user.displayName || name,
      companyName: user.organizationName || metadata.companyName || null,
      organizationName: user.organizationName || metadata.companyName || null,
      jobTitle: metadata.jobTitle || null,
      phone: user.phoneNumber || null,
      phoneNumber: user.phoneNumber || null,
      avatarUrl: user.avatarUrl || user.profilePicture || null,
      googleLinked: !!user.googleId,
      microsoftLinked: !!user.microsoftId,
      hasPassword: passwordHash !== null && passwordHash !== '',
      credits: wallet.balance,
      wallet: {
        dailyCredits: wallet.dailyCredits ?? 5,
        purchasedCredits: wallet.purchasedCredits ?? 0,
        balance: wallet.balance,
        lifetimePurchased: wallet.lifetimePurchased ?? 0,
        lifetimeUsed: wallet.lifetimeUsed ?? 0,
        lastDailyCreditDate: wallet.lastDailyCreditDate,
      },
    };
  }

  /**
   * Updates user profile fields
   */
  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.userRepo.findById(userId);
    if (!user) {
      throw new BusinessException('User not found', 'USER_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    const rawName = dto.name || dto.displayName;
    let firstName = dto.firstName;
    let lastName = dto.lastName;
    if (rawName && (firstName === undefined || lastName === undefined)) {
      const parts = rawName.split(' ');
      firstName = parts[0] || '';
      lastName = parts.slice(1).join(' ') || '';
    }

    const displayName = dto.displayName || dto.name || (firstName ? `${firstName} ${lastName || ''}`.trim() : user.displayName);
    const organizationName = dto.organizationName !== undefined ? dto.organizationName : (dto.companyName !== undefined ? dto.companyName : user.organizationName);
    const phoneNumber = dto.phoneNumber !== undefined ? dto.phoneNumber : (dto.phone !== undefined ? dto.phone : user.phoneNumber);
    const rawAvatar = dto.avatarUrl !== undefined ? dto.avatarUrl : dto.profilePicture;
    const avatarUrl = rawAvatar !== undefined ? (rawAvatar ? validateAvatarImage(rawAvatar) : rawAvatar) : user.avatarUrl;

    const currentMeta = (user.metadata as Record<string, any>) || {};
    let updatedMeta = { ...currentMeta };
    if (dto.jobTitle !== undefined) {
      updatedMeta.jobTitle = dto.jobTitle;
    }

    await this.db
      .update(schema.users)
      .set({
        firstName: firstName !== undefined ? firstName : user.firstName,
        lastName: lastName !== undefined ? lastName : user.lastName,
        displayName: displayName !== undefined ? displayName : user.displayName,
        phoneNumber: phoneNumber !== undefined ? phoneNumber : user.phoneNumber,
        organizationName: organizationName !== undefined ? organizationName : user.organizationName,
        avatarUrl: avatarUrl !== undefined ? avatarUrl : user.avatarUrl,
        profilePicture: avatarUrl !== undefined ? avatarUrl : user.profilePicture,
        metadata: updatedMeta,
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, userId));

    return this.getProfile(userId);
  }

  /**
   * Uploads or updates profile photo avatar (M-4 / SG-24 validation applied)
   */
  async uploadAvatar(userId: string, image: string) {
    const validatedImage = validateAvatarImage(image);
    const user = await this.userRepo.findById(userId);
    if (!user) {
      throw new BusinessException('User not found', 'USER_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    await this.db
      .update(schema.users)
      .set({
        avatarUrl: validatedImage,
        profilePicture: validatedImage,
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, userId));

    return this.getProfile(userId);
  }

  /**
   * Changes or sets account password
   */
  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.userRepo.findById(userId);
    if (!user) {
      throw new BusinessException('User not found', 'USER_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    if (user.passwordHash) {
      if (!dto.currentPassword) {
        throw new BusinessException('Current password is required', 'CURRENT_PASSWORD_REQUIRED', HttpStatus.BAD_REQUEST);
      }
      const isMatch = await this.passwordService.compare(dto.currentPassword, user.passwordHash);
      if (!isMatch) {
        await this.auditLog?.record({ userId, action: 'PASSWORD_CHANGE_FAILED', entityType: 'AUTH', entityId: userId, outcome: 'FAILURE', failureCategory: 'BAD_CURRENT_PASSWORD' });
        throw new BusinessException('Current password does not match', 'INVALID_PASSWORD', HttpStatus.UNAUTHORIZED);
      }
    }

    const newHash = await this.passwordService.hash(dto.newPassword);
    await this.userRepo.updateById(userId, {
      passwordHash: newHash,
      updatedAt: new Date(),
    });

    // Revoke existing refresh tokens
    await this.userRepo.revokeAllUserRefreshTokens(userId);
    await this.auditLog?.record({ userId, action: 'PASSWORD_CHANGED', entityType: 'AUTH', entityId: userId, outcome: 'SUCCESS', newValues: { sessionsRevoked: true, hadPassword: !!user.passwordHash } });

    return { success: true, message: 'Password updated successfully.' };
  }

  /**
   * Updates user notification/system settings
   */
  async updateSettings(userId: string, dto: UpdateUserSettingsDto) {
    const user = await this.userRepo.findById(userId);
    if (!user) {
      throw new BusinessException('User not found', 'USER_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    // Only the documented preference keys may be written. `users.metadata` also holds security state (activeSessionId,
    // mfaLastStep, passwordChangedAt, ...), so an open-ended merge would let a caller overwrite it; and echoing the whole object
    // back would hand that state out. Unknown keys are refused loudly (400) rather than silently dropped.
    const incoming = (dto.preferences ?? {}) as Record<string, unknown>;
    const accepted: Record<string, string | boolean> = {};
    for (const [key, value] of Object.entries(incoming)) {
      const type = USER_SETTING_KEYS[key];
      if (!type || typeof value !== type) {
        throw new BusinessException(
          type ? `Setting "${key}" must be a ${type}` : `Unsupported setting "${key}"`,
          'INVALID_SETTING',
          HttpStatus.BAD_REQUEST,
        );
      }
      accepted[key] = typeof value === 'string' ? value.slice(0, MAX_USER_SETTING_STRING) : (value as boolean);
    }

    const currentMeta = (user.metadata as Record<string, unknown>) || {};
    const updatedMeta = { ...currentMeta, ...accepted };

    await this.userRepo.updateById(userId, {
      metadata: updatedMeta,
      updatedAt: new Date(),
    });

    const preferences: Record<string, unknown> = {};
    for (const key of Object.keys(USER_SETTING_KEYS)) {
      if (updatedMeta[key] !== undefined) preferences[key] = updatedMeta[key];
    }
    return { success: true, preferences };
  }
}
