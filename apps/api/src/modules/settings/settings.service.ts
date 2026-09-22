import { Injectable, Logger, HttpStatus, Inject } from '@nestjs/common';
import {
  UpdateCompanyDetailsDto,
  UpdateNotificationPreferencesDto,
  UpdateBillingPreferencesDto,
} from './dto/settings.dto';
import { UserRepository } from '../user/user.repository';
import { BusinessException } from '../../common/errors/business.exception';
import { DRIZZLE_DATABASE } from '../../database/database.constants';
import { DrizzleDb } from '../../database/database.provider';
import * as schema from '../../database/schema';
import { eq } from 'drizzle-orm';

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    private readonly userRepo: UserRepository,
    @Inject(DRIZZLE_DATABASE)
    private readonly db: DrizzleDb,
  ) {}

  /**
   * Retrieves all customer settings
   */
  async getSettings(userId: string) {
    const user = await this.userRepo.findById(userId);
    if (!user) {
      throw new BusinessException('User not found', 'USER_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    const metadata = (user.metadata as Record<string, any>) || {};

    return {
      profile: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        phoneNumber: user.phoneNumber,
        avatarUrl: user.avatarUrl,
        isEmailVerified: user.isEmailVerified,
      },
      company: {
        organizationName: user.organizationName || metadata.companyDetails?.organizationName || '',
        industry: metadata.companyDetails?.industry || '',
        companySize: metadata.companyDetails?.companySize || '',
        websiteUrl: metadata.companyDetails?.websiteUrl || '',
        gstin: metadata.companyDetails?.gstin || '',
      },
      notifications: {
        emailNewBusinesses: metadata.notifications?.emailNewBusinesses ?? true,
        savedSearchAlerts: metadata.notifications?.savedSearchAlerts ?? true,
        creditLowWarning: metadata.notifications?.creditLowWarning ?? true,
        weeklyDigest: metadata.notifications?.weeklyDigest ?? false,
        productUpdates: metadata.notifications?.productUpdates ?? true,
        marketingEmails: metadata.notifications?.marketingEmails ?? false,
        emailOnLeadUnlock: metadata.notifications?.emailOnLeadUnlock ?? true,
        marketingUpdates: metadata.notifications?.marketingUpdates ?? false,
      },
      billing: {
        currency: metadata.billing?.currency || 'INR',
        billingEmail: metadata.billing?.billingEmail || user.email,
        billingAddress: metadata.billing?.billingAddress || '',
      },
      security: {
        twoFactorEnabled: user.twoFactorEnabled,
        lastLoginAt: user.lastLoginAt,
      },
    };
  }

  /**
   * Updates company settings
   */
  async updateCompany(userId: string, dto: UpdateCompanyDetailsDto) {
    const user = await this.userRepo.findById(userId);
    if (!user) {
      throw new BusinessException('User not found', 'USER_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    const metadata = (user.metadata as Record<string, any>) || {};
    const updatedMetadata = {
      ...metadata,
      companyDetails: {
        ...metadata.companyDetails,
        ...dto,
      },
    };

    await this.userRepo.updateById(userId, {
      organizationName: dto.organizationName !== undefined ? dto.organizationName : user.organizationName,
      metadata: updatedMetadata,
      updatedAt: new Date(),
    });

    return { success: true, message: 'Company details updated', company: updatedMetadata.companyDetails };
  }

  /**
   * Updates notification preferences
   */
  async updateNotifications(userId: string, dto: UpdateNotificationPreferencesDto) {
    const user = await this.userRepo.findById(userId);
    if (!user) {
      throw new BusinessException('User not found', 'USER_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    const metadata = (user.metadata as Record<string, any>) || {};
    const updatedMetadata = {
      ...metadata,
      notifications: {
        ...metadata.notifications,
        ...dto,
      },
    };

    await this.userRepo.updateById(userId, {
      metadata: updatedMetadata,
      updatedAt: new Date(),
    });

    return { success: true, message: 'Notification preferences saved', notifications: updatedMetadata.notifications };
  }

  /**
   * Updates billing preferences
   */
  async updateBilling(userId: string, dto: UpdateBillingPreferencesDto) {
    const user = await this.userRepo.findById(userId);
    if (!user) {
      throw new BusinessException('User not found', 'USER_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    const metadata = (user.metadata as Record<string, any>) || {};
    const updatedMetadata = {
      ...metadata,
      billing: {
        ...metadata.billing,
        ...dto,
      },
    };

    await this.userRepo.updateById(userId, {
      metadata: updatedMetadata,
      updatedAt: new Date(),
    });

    return { success: true, message: 'Billing preferences saved', billing: updatedMetadata.billing };
  }
}
