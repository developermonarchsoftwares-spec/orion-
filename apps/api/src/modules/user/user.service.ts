import { Injectable, Logger, HttpStatus, Inject, forwardRef } from '@nestjs/common';
import { UserRepository } from './user.repository';
import { UpdateProfileDto, ChangePasswordDto, UpdateUserSettingsDto } from './dto/user.dto';
import { PasswordService } from '../../auth/services/password.service';
import { CreditService } from '../credit/credit.service';
import { BusinessException } from '../../common/errors/business.exception';
import { DRIZZLE_DATABASE } from '../../database/database.constants';
import { DrizzleDb } from '../../database/database.provider';
import * as schema from '../../database/schema';
import { eq } from 'drizzle-orm';

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

    const { passwordHash, twoFactorSecret, ...sanitized } = user;
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
    const avatarUrl = dto.avatarUrl !== undefined ? dto.avatarUrl : (dto.profilePicture !== undefined ? dto.profilePicture : user.avatarUrl);

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
   * Uploads or updates profile photo avatar
   */
  async uploadAvatar(userId: string, image: string) {
    const user = await this.userRepo.findById(userId);
    if (!user) {
      throw new BusinessException('User not found', 'USER_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    await this.db
      .update(schema.users)
      .set({
        avatarUrl: image,
        profilePicture: image,
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

    const currentMeta = (user.metadata as Record<string, unknown>) || {};
    const updatedMeta = { ...currentMeta, ...dto.preferences };

    await this.userRepo.updateById(userId, {
      metadata: updatedMeta,
      updatedAt: new Date(),
    });

    return { success: true, preferences: updatedMeta };
  }
}
