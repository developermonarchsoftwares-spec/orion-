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
  Inject,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import * as crypto from 'crypto';
import { eq, and, gt, lt, or } from 'drizzle-orm';
import { Public, CurrentUser } from './decorators';
import { UserRepository } from '../modules/user/user.repository';
import { AuthTokenService } from './services/auth-token.service';
import { DRIZZLE_DATABASE } from '../database/database.constants';
import { DrizzleDb } from '../database/database.provider';
import { adminOtps } from '../database/schema';
import { AuditLogService } from '../common/services/audit-log.service';
import { IJwtPayload } from '@orion/shared';
import { CsvSecurityUtil } from '../common/utils/csv-security.util';

@ApiTags('Admin Authentication')
@Controller('admin')
export class AdminAuthController {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly authTokenService: AuthTokenService,
    @Inject(DRIZZLE_DATABASE) private readonly db: DrizzleDb,
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

    // Clean expired OTPs and any existing OTP for this email, then insert new OTP into Neon DB
    try {
      await this.db
        .delete(adminOtps)
        .where(or(lt(adminOtps.expiresAt, new Date()), eq(adminOtps.email, email)));

      await this.db.insert(adminOtps).values({
        email,
        otp,
        attempts: 0,
        maxAttempts: 5,
        expiresAt: new Date(Date.now() + ttlSeconds * 1000),
      });
    } catch (err: any) {
      // In case of transient db issue, log error
      console.error('[AdminAuthController] Failed to store OTP in Neon DB:', err.message);
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

    // Retrieve active OTP record from Neon DB
    let otpRecord: typeof adminOtps.$inferSelect | undefined;
    try {
      const records = await this.db
        .select()
        .from(adminOtps)
        .where(and(eq(adminOtps.email, email), gt(adminOtps.expiresAt, new Date())))
        .limit(1);
      otpRecord = records[0];
    } catch (err: any) {
      console.error('[AdminAuthController] Failed to read OTP from Neon DB:', err.message);
    }

    // Check brute-force attempt lockout
    if (otpRecord && otpRecord.attempts >= otpRecord.maxAttempts) {
      throw new HttpException(
        'Too many failed attempts. This verification session is locked. Please request a new code.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // In dev/test, allow deterministic '123456' fallback if no record found
    const isProd = process.env.NODE_ENV === 'production';
    const isValidOtp =
      otpRecord !== undefined
        ? String(otpRecord.otp).trim() === otp
        : !isProd && otp === '123456';

    if (!isValidOtp) {
      // Increment failed attempt counter in Neon DB
      if (otpRecord) {
        try {
          await this.db
            .update(adminOtps)
            .set({ attempts: otpRecord.attempts + 1 })
            .where(eq(adminOtps.id, otpRecord.id));
        } catch {}
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
    if (otpRecord) {
      try {
        await this.db.delete(adminOtps).where(eq(adminOtps.id, otpRecord.id));
      } catch {}
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
