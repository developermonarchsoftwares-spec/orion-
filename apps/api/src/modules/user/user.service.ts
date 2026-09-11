import { Injectable, Logger, HttpStatus, Inject } from '@nestjs/common';
import { UserRepository } from './user.repository';
import { UpdateProfileDto, ChangePasswordDto, UpdateUserSettingsDto } from './dto/user.dto';
import { PasswordService } from '../../auth/services/password.service';
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

    // Get wallet balance
    const walletRows = await this.db
      .select()
      .from(schema.userWallets)
      .where(eq(schema.userWallets.userId, userId))
      .limit(1);

    const wallet = walletRows[0] || { balance: 0, lifetimePurchased: 0, lifetimeUsed: 0 };

    const { passwordHash, twoFactorSecret, ...sanitized } = user;
    return {
      ...sanitized,
      googleLinked: !!user.googleId,
      microsoftLinked: !!user.microsoftId,
      hasPassword: passwordHash !== null && passwordHash !== '',
      credits: wallet.balance,
      wallet: {
        dailyCredits: (wallet as any).dailyCredits ?? 5,
        purchasedCredits: (wallet as any).purchasedCredits ?? 0,
        balance: wallet.balance,
        lifetimePurchased: wallet.lifetimePurchased,
        lifetimeUsed: wallet.lifetimeUsed,
        lastDailyCreditDate: (wallet as any).lastDailyCreditDate,
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

    const [updated] = await this.db
      .update(schema.users)
      .set({
        firstName: dto.firstName !== undefined ? dto.firstName : user.firstName,
        lastName: dto.lastName !== undefined ? dto.lastName : user.lastName,
        displayName: dto.displayName !== undefined ? dto.displayName : user.displayName,
        phoneNumber: dto.phoneNumber !== undefined ? dto.phoneNumber : user.phoneNumber,
        organizationName: dto.organizationName !== undefined ? dto.organizationName : user.organizationName,
        avatarUrl: dto.avatarUrl !== undefined ? dto.avatarUrl : user.avatarUrl,
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, userId))
      .returning();

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
