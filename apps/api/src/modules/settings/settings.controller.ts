import {
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { SettingsService } from './settings.service';
import {
  UpdateCompanyDetailsDto,
  UpdateNotificationPreferencesDto,
  UpdateBillingPreferencesDto,
} from './dto/settings.dto';
import { CurrentUser } from '../../auth/decorators';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { IJwtPayload } from '@orion/shared';

@ApiTags('Settings')
@Controller('settings')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Get unified settings (profile, company, notifications, billing, security)' })
  @ApiResponse({ status: 200, description: 'User settings structure' })
  async getSettings(@CurrentUser() user: IJwtPayload) {
    return this.settingsService.getSettings(user.sub);
  }

  @Patch('company')
  @ApiOperation({ summary: 'Update company organization details' })
  @ApiResponse({ status: 200, description: 'Company details updated' })
  async updateCompany(
    @CurrentUser() user: IJwtPayload,
    @Body() dto: UpdateCompanyDetailsDto,
  ) {
    return this.settingsService.updateCompany(user.sub, dto);
  }

  @Patch('notifications')
  @ApiOperation({ summary: 'Update notification alert preferences' })
  @ApiResponse({ status: 200, description: 'Notification settings updated' })
  async updateNotifications(
    @CurrentUser() user: IJwtPayload,
    @Body() dto: UpdateNotificationPreferencesDto,
  ) {
    return this.settingsService.updateNotifications(user.sub, dto);
  }

  @Patch('billing')
  @ApiOperation({ summary: 'Update billing preferences and currency' })
  @ApiResponse({ status: 200, description: 'Billing settings updated' })
  async updateBilling(
    @CurrentUser() user: IJwtPayload,
    @Body() dto: UpdateBillingPreferencesDto,
  ) {
    return this.settingsService.updateBilling(user.sub, dto);
  }
}
