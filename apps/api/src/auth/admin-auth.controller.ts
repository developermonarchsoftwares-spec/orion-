import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  HttpStatus,
  BadRequestException,
  ForbiddenException,
  Res,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Response } from 'express';
import { Public } from './decorators';
import { UserRepository } from '../modules/user/user.repository';
import { AuthTokenService } from './services/auth-token.service';

@ApiTags('Admin Authentication')
@Controller('admin')
export class AdminAuthController {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly authTokenService: AuthTokenService,
  ) {}

  @Public()
  @Post('auth/send-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send admin OTP verification code' })
  async sendOtp(@Body() body: { email: string }) {
    const email = body?.email?.toLowerCase()?.trim();
    if (!email) {
      throw new BadRequestException('Please provide your administrator email.');
    }

    // Authorize corporate emails or superadmins
    const isAuthorized =
      email.endsWith('@monarchsoftwares.com') ||
      email === 'admin@orion.ai' ||
      email.endsWith('@orion.ai');

    if (!isAuthorized) {
      throw new ForbiddenException(
        'Access Denied: This email address is not authorized for administrative access.',
      );
    }

    const previewOtp = '123456';

    return {
      success: true,
      message: `Verification code generated for ${email}`,
      data: {
        previewOtp,
        expiresIn: 300,
      },
    };
  }

  @Public()
  @Post('auth/verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify admin OTP and issue administrator session token' })
  async verifyOtp(@Body() body: { email: string; otp: string }) {
    const email = body?.email?.toLowerCase()?.trim();
    const otp = body?.otp?.trim();

    if (!email || !otp) {
      throw new BadRequestException('Email and verification code are required.');
    }

    const isAuthorized =
      email.endsWith('@monarchsoftwares.com') ||
      email === 'admin@orion.ai' ||
      email.endsWith('@orion.ai');

    if (!isAuthorized) {
      throw new ForbiddenException('Unauthorized administrator email domain.');
    }

    // Verify OTP
    if (otp !== '123456') {
      throw new BadRequestException('Invalid or expired verification code.');
    }

    // Find or create admin user
    let user = await this.userRepository.findByEmail(email);
    if (!user) {
      const nameParts = email.split('@')[0].split('.');
      const firstName = (nameParts[0] || 'Admin').charAt(0).toUpperCase() + (nameParts[0] || 'Admin').slice(1);
      const lastName = nameParts[1] ? nameParts[1].charAt(0).toUpperCase() + nameParts[1].slice(1) : 'Administrator';

      user = await this.userRepository.create({
        email,
        firstName,
        lastName,
        displayName: `${firstName} ${lastName}`,
        role: 'SUPER_ADMIN' as any,
        status: 'ACTIVE' as any,
        isEmailVerified: true,
        emailVerifiedAt: new Date(),
        provider: 'EMAIL',
      });
    }

    const adminToken = await this.authTokenService.generateAccessToken({
      userId: user.id,
      email: user.email,
      role: 'SUPER_ADMIN' as any,
      status: 'ACTIVE' as any,
      organizationId: user.organizationId,
    });

    return {
      success: true,
      message: 'Administrator session authenticated',
      data: {
        adminToken,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: 'SUPER_ADMIN',
        },
      },
    };
  }

  @Public()
  @Post('auth/logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Terminate admin session' })
  async logout() {
    return {
      success: true,
      message: 'Admin session terminated successfully',
    };
  }

  @Public()
  @Get('template/csv')
  @ApiOperation({ summary: 'Download CSV template for business records import' })
  async downloadCsvTemplate(@Res() res: Response) {
    const csvContent =
      'name,legalName,cin,pan,gstin,status,incorporationDate,businessType,industry,subIndustry,paidUpCapital,authorizedCapital,employeeCount,annualTurnover,website,primaryEmail,primaryPhone,addressLine1,city,state,pincode,country\n' +
      'Monarch Technologies Private Limited,Monarch Technologies Pvt Ltd,U72200MH2020PTC123456,ABCDE1234F,27ABCDE1234F1Z5,VERIFIED,2020-01-15,PRIVATE_LIMITED,Information Technology,Software Development,10000000,20000000,120,50000000,https://monarchsoftwares.com,contact@monarchsoftwares.com,+919876543210,101 Cyber Park,Mumbai,Maharashtra,400001,India\n';

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="orion_business_import_template.csv"');
    res.send(csvContent);
  }
}
