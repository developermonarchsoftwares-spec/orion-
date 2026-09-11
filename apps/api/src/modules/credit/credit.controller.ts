import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { CreditService } from './credit.service';
import { CurrentUser, Public, Roles } from '../../auth/decorators';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { IJwtPayload, UserRole } from '@orion/shared';

@ApiTags('Credits & Wallet')
@Controller('credit')
export class CreditController {
  constructor(private readonly creditService: CreditService) {}

  @UseGuards(JwtAuthGuard)
  @Get('wallet')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user credit balance and wallet statistics' })
  @ApiResponse({ status: 200, description: 'Wallet balance, daily credits, and lifetime metrics' })
  async getWallet(@CurrentUser() user: IJwtPayload) {
    return this.creditService.getWallet(user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Get('transactions')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get paginated credit transaction history' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Transaction ledger list' })
  async getTransactions(
    @CurrentUser() user: IJwtPayload,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.creditService.getTransactions(user.sub, Number(page), Number(limit));
  }

  @Public()
  @Get('packages')
  @ApiOperation({ summary: 'Get all active credit packages with dynamic annual pricing' })
  @ApiResponse({ status: 200, description: 'List of credit packages' })
  async getPackages() {
    return this.creditService.getPackages();
  }

  @Public()
  @Get('config')
  @ApiOperation({ summary: 'Get platform pricing and credit configuration' })
  @ApiResponse({ status: 200, description: 'Pricing configuration policies' })
  async getPricingConfig() {
    return this.creditService.getPricingConfig();
  }

  // ================= ADMIN MANAGEMENT ROUTES =================

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Get('admin/packages')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin: Get all packages (active & inactive)' })
  async adminGetAllPackages() {
    return this.creditService.getAllPackages();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Post('admin/packages')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin: Create new credit package' })
  async adminCreatePackage(@Body() dto: any) {
    return this.creditService.createPackage(dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Put('admin/packages/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin: Update credit package' })
  async adminUpdatePackage(@Param('id') id: string, @Body() dto: any) {
    return this.creditService.updatePackage(id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Delete('admin/packages/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin: Delete credit package' })
  async adminDeletePackage(@Param('id') id: string) {
    return this.creditService.deletePackage(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Put('admin/config')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin: Update pricing settings config' })
  async adminUpdateConfig(@Body() body: { key: string; value: any; description?: string }) {
    return this.creditService.updatePricingSetting(body.key, body.value, body.description);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Post('admin/adjust')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin: Adjust user wallet credits' })
  async adminAdjustCredits(
    @CurrentUser() admin: IJwtPayload,
    @Body() body: { userId: string; dailyDelta: number; purchasedDelta: number; reason: string },
  ) {
    return this.creditService.adjustUserCredits(
      body.userId,
      body.dailyDelta || 0,
      body.purchasedDelta || 0,
      body.reason || 'Manual Admin Adjustment',
      admin.sub,
    );
  }
}
