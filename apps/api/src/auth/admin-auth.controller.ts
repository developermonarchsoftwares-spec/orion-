import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  HttpCode,
  HttpStatus,
  BadRequestException,
  ForbiddenException,
  HttpException,
  Res,
  Optional,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import * as crypto from 'crypto';
import { Public, CurrentUser } from './decorators';
import { UserRepository } from '../modules/user/user.repository';
import { AuthTokenService } from './services/auth-token.service';
import { RedisService } from '../modules/redis/redis.service';
import { AuditLogService } from '../common/services/audit-log.service';
import { IJwtPayload } from '@orion/shared';
import { CsvSecurityUtil } from '../common/utils/csv-security.util';

@ApiTags('Admin Authentication')
@Controller('admin')
export class AdminAuthController {
  // In-memory fallback if Redis is temporarily unreachable in dev/test
  private readonly fallbackOtpStore = new Map<string, { otp: string; expiresAt: number; attempts: number }>();

  constructor(
    private readonly userRepository: UserRepository,
    private readonly authTokenService: AuthTokenService,
    @Optional() private readonly redisService?: RedisService,
    @Optional() private readonly auditLogService?: AuditLogService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 300000 } }) // 5 requests per 5 minutes
  @Post('auth/send-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send admin OTP verification code' })
  async sendOtp(@Body() body: { email: string }, @Req() req: Request) {
    const email = body?.email?.toLowerCase()?.trim();
    if (!email) {
      throw new BadRequestException('Please provide your administrator email.');
    }

    // Authorize any email address belonging to @monarchsoftwares.com domain
    const emailParts = email.split('@');
    const isAuthorized =
      emailParts.length === 2 && Boolean(emailParts[0]) && emailParts[1] === 'monarchsoftwares.com';

    if (!isAuthorized) {
      await this.auditLogService?.record({
        action: 'ADMIN_OTP_UNAUTHORIZED_DOMAIN',
        entityType: 'ADMIN_AUTH',
        entityId: email,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
      throw new ForbiddenException(
        'Access Denied: Only @monarchsoftwares.com email addresses are authorized for administrative access.',
      );
    }

    const isProd = process.env.NODE_ENV === 'production';
    const otp = isProd
      ? crypto.randomInt(100000, 999999).toString()
      : '123456';
    const ttlSeconds = 300; // 5 minutes

    if (this.redisService) {
      try {
        await this.redisService.set(`admin:otp:${email}`, otp, ttlSeconds);
        await this.redisService.set(`admin:otp:attempts:${email}`, 0, ttlSeconds);
      } catch {
        this.fallbackOtpStore.set(email, {
          otp,
          expiresAt: Date.now() + ttlSeconds * 1000,
          attempts: 0,
        });
      }
    } else {
      this.fallbackOtpStore.set(email, {
        otp,
        expiresAt: Date.now() + ttlSeconds * 1000,
        attempts: 0,
      });
    }

    await this.auditLogService?.record({
      action: 'ADMIN_OTP_GENERATED',
      entityType: 'ADMIN_AUTH',
      entityId: email,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    const responseData: Record<string, unknown> = {
      expiresIn: ttlSeconds,
    };

    // previewOtp is strictly ONLY exposed during automated test execution (NODE_ENV=test)
    if (process.env.NODE_ENV === 'test') {
      responseData.previewOtp = otp;
    }

    return {
      success: true,
      message: `Verification code generated for ${email}`,
      data: responseData,
    };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 300000 } })
  @Post('auth/verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify admin OTP and issue administrator session token' })
  async verifyOtp(@Body() body: { email: string; otp: string }, @Req() req: Request) {
    const email = body?.email?.toLowerCase()?.trim();
    const otp = body?.otp?.trim();

    if (!email || !otp) {
      throw new BadRequestException('Email and verification code are required.');
    }

    const emailParts = email.split('@');
    const isAuthorized =
      emailParts.length === 2 && Boolean(emailParts[0]) && emailParts[1] === 'monarchsoftwares.com';

    if (!isAuthorized) {
      throw new ForbiddenException(
        'Access Denied: Only @monarchsoftwares.com email addresses are authorized for administrative access.',
      );
    }

    // Retrieve expected OTP and verify attempts
    let expectedOtp: string | null = null;
    let attempts = 0;

    if (this.redisService) {
      try {
        expectedOtp = await this.redisService.get<string>(`admin:otp:${email}`);
        const currentAttempts = await this.redisService.get<number>(`admin:otp:attempts:${email}`);
        attempts = Number(currentAttempts) || 0;
      } catch {
        const cached = this.fallbackOtpStore.get(email);
        if (cached && cached.expiresAt > Date.now()) {
          expectedOtp = cached.otp;
          attempts = cached.attempts;
        }
      }
    } else {
      const cached = this.fallbackOtpStore.get(email);
      if (cached && cached.expiresAt > Date.now()) {
        expectedOtp = cached.otp;
        attempts = cached.attempts;
      }
    }

    // Check brute-force attempt lockout
    if (attempts >= 5) {
      throw new HttpException(
        'Too many failed attempts. This verification session is locked. Please request a new code.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // In dev/test, allow deterministic '123456' fallback if Redis key expired or not set
    const isProd = process.env.NODE_ENV === 'production';
    const isValidOtp =
      expectedOtp !== null
        ? String(expectedOtp).trim() === otp
        : !isProd && otp === '123456';

    if (!isValidOtp) {
      // Increment failed attempt counter
      if (this.redisService) {
        try {
          await this.redisService.incr(`admin:otp:attempts:${email}`);
        } catch {
          const cached = this.fallbackOtpStore.get(email);
          if (cached) cached.attempts++;
        }
      } else {
        const cached = this.fallbackOtpStore.get(email);
        if (cached) cached.attempts++;
      }

      await this.auditLogService?.record({
        action: 'ADMIN_OTP_FAILED',
        entityType: 'ADMIN_AUTH',
        entityId: email,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      throw new BadRequestException('Invalid or expired verification code.');
    }

    // Invalidate OTP immediately to prevent replay attacks
    if (this.redisService) {
      try {
        await this.redisService.del([`admin:otp:${email}`, `admin:otp:attempts:${email}`]);
      } catch {
        this.fallbackOtpStore.delete(email);
      }
    } else {
      this.fallbackOtpStore.delete(email);
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

    await this.auditLogService?.record({
      userId: user.id,
      action: 'ADMIN_LOGIN_SUCCESS',
      entityType: 'USER',
      entityId: user.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
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
  async logout(@CurrentUser() user?: IJwtPayload, @Req() req?: Request) {
    if (user?.sub) {
      await this.auditLogService?.record({
        userId: user.sub,
        action: 'ADMIN_LOGOUT',
        entityType: 'USER',
        entityId: user.sub,
        ipAddress: req?.ip,
        userAgent: req?.headers['user-agent'] as string,
      });
    }

    return {
      success: true,
      message: 'Admin session terminated successfully',
    };
  }

  @Public()
  @Get('template/csv')
  @ApiOperation({ summary: 'Download CSV template for business records import' })
  async downloadCsvTemplate(@Res() res: Response) {
    const headers = [
      'name', 'legalName', 'cin', 'pan', 'gstin', 'status',
      'incorporationDate', 'businessType', 'industry', 'subIndustry',
      'paidUpCapital', 'authorizedCapital', 'employeeCount', 'annualTurnover',
      'website', 'primaryEmail', 'primaryPhone', 'addressLine1', 'city',
      'state', 'pincode', 'country',
    ];

    const sampleRow = [
      'Monarch Technologies Private Limited',
      'Monarch Technologies Pvt Ltd',
      'U72200MH2020PTC123456',
      'ABCDE1234F',
      '27ABCDE1234F1Z5',
      'VERIFIED',
      '2020-01-15',
      'PRIVATE_LIMITED',
      'Information Technology',
      'Software Development',
      '10000000',
      '20000000',
      '120',
      '50000000',
      'https://monarchsoftwares.com',
      'contact@monarchsoftwares.com',
      '+919876543210',
      '101 Cyber Park',
      'Mumbai',
      'Maharashtra',
      '400001',
      'India',
    ];

    const csvContent = `${headers.join(',')}\n${CsvSecurityUtil.formatCsvRow(sampleRow)}\n`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="orion_business_import_template.csv"');
    res.send(csvContent);
  }
}
