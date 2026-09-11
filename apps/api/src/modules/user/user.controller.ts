import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { UserService } from './user.service';
import { UpdateProfileDto, ChangePasswordDto, UpdateUserSettingsDto } from './dto/user.dto';
import { CurrentUser } from '../../auth/decorators';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { IJwtPayload } from '@orion/shared';

@ApiTags('User')
@Controller('user')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('profile')
  @ApiOperation({ summary: 'Get current user profile and credit overview' })
  @ApiResponse({ status: 200, description: 'User Profile and Balance' })
  async getProfile(@CurrentUser() user: IJwtPayload) {
    return this.userService.getProfile(user.sub);
  }

  @Get('me')
  @ApiOperation({ summary: 'Alias for profile retrieval' })
  @ApiResponse({ status: 200, description: 'User Profile and Balance' })
  async getMe(@CurrentUser() user: IJwtPayload) {
    return this.userService.getProfile(user.sub);
  }

  @Patch('profile')
  @ApiOperation({ summary: 'Update profile details' })
  @ApiResponse({ status: 200, description: 'Updated User Profile' })
  async updateProfile(
    @CurrentUser() user: IJwtPayload,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.userService.updateProfile(user.sub, dto);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change account password' })
  @ApiResponse({ status: 200, description: 'Password changed successfully' })
  async changePassword(
    @CurrentUser() user: IJwtPayload,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.userService.changePassword(user.sub, dto);
  }

  @Patch('settings')
  @ApiOperation({ summary: 'Update notification and system settings' })
  @ApiResponse({ status: 200, description: 'Preferences saved' })
  async updateSettings(
    @CurrentUser() user: IJwtPayload,
    @Body() dto: UpdateUserSettingsDto,
  ) {
    return this.userService.updateSettings(user.sub, dto);
  }
}
