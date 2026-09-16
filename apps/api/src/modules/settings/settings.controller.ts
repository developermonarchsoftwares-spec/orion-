import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { SettingsService } from './settings.service';
import { ApiKeyService } from './services/api-key.service';
import {
  UpdateCompanyDetailsDto,
  UpdateNotificationPreferencesDto,
  UpdateBillingPreferencesDto,
} from './dto/settings.dto';
import { CreateApiKeyDto } from './dto/api-key.dto';
import { CurrentUser } from '../../auth/decorators';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { IJwtPayload } from '@orion/shared';

@ApiTags('Settings')
@Controller('settings')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly apiKeyService: ApiKeyService,
  ) {}

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

  // ================= API KEY MANAGEMENT (REQUIREMENT 30) =================

  @Post('api-keys')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new secure API key' })
  @ApiResponse({ status: 201, description: 'API key created with one-time plaintext key reveal' })
  async createApiKey(
    @CurrentUser() user: IJwtPayload,
    @Body() dto: CreateApiKeyDto,
  ) {
    return this.apiKeyService.createApiKey(user.sub, dto);
  }

  @Get('api-keys')
  @ApiOperation({ summary: 'List all active and inactive API keys for the current user' })
  @ApiResponse({ status: 200, description: 'List of API keys (prefix only, never plaintext secret)' })
  async listApiKeys(@CurrentUser() user: IJwtPayload) {
    return this.apiKeyService.listApiKeys(user.sub);
  }

  @Delete('api-keys/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke an existing API key' })
  @ApiResponse({ status: 200, description: 'API key revoked successfully' })
  async revokeApiKey(
    @CurrentUser() user: IJwtPayload,
    @Param('id') id: string,
  ) {
    return this.apiKeyService.revokeApiKey(user.sub, id);
  }
}
