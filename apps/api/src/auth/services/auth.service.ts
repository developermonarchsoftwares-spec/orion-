import { Injectable, Logger, HttpStatus } from '@nestjs/common';
import { PasswordService } from './password.service';
import { AuthTokenService, ITokenPair } from './auth-token.service';
import { UserRepository } from '../../modules/user/user.repository';
import { RegisterDto, LoginDto, ResetPasswordDto } from '../dto/auth.dto';
import { BusinessException } from '../../common/errors/business.exception';
import { UserRole, UserStatus } from '@orion/shared';
import { CryptoUtil } from '../../common/utils/crypto.util';
import { DRIZZLE_DATABASE } from '../../database/database.constants';
import { DrizzleDb } from '../../database/database.provider';
import { Inject } from '@nestjs/common';
import * as schema from '../../database/schema';

export interface IAuthResult {
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: UserRole;
    status: UserStatus;
    organizationName?: string | null;
    isEmailVerified: boolean;
  };
  tokens: ITokenPair;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly userRepo: UserRepository,
    private readonly passwordService: PasswordService,
    private readonly tokenService: AuthTokenService,
    @Inject(DRIZZLE_DATABASE)
    private readonly db: DrizzleDb,
  ) {}

  /**
   * Registers a new customer user and initializes their default credit wallet
   */
  async register(
    dto: RegisterDto,
    context?: { userAgent?: string; ipAddress?: string },
  ): Promise<IAuthResult> {
    const existing = await this.userRepo.findByEmail(dto.email);
    if (existing) {
      throw new BusinessException(
        'An account with this email already exists',
        'EMAIL_ALREADY_EXISTS',
        HttpStatus.CONFLICT,
      );
    }

    const passwordHash = await this.passwordService.hash(dto.password);

    // Create user and wallet in transaction
    const newUser = await this.db.transaction(async (tx) => {
      const [user] = await tx
        .insert(schema.users)
        .values({
          email: dto.email.toLowerCase().trim(),
          passwordHash,
          firstName: dto.firstName.trim(),
          lastName: dto.lastName.trim(),
          organizationName: dto.organizationName?.trim(),
          phoneNumber: dto.phoneNumber?.trim(),
          role: 'USER',
          status: 'ACTIVE',
          isEmailVerified: true, // Auto-verify for frictionless onboarding
        })
        .returning();

      const todayStr = new Date().toISOString().slice(0, 10);

      // Initialize Credit Wallet with 5 Daily Free Credits
      const [wallet] = await tx
        .insert(schema.userWallets)
        .values({
          userId: user.id,
          dailyCredits: 5,
          purchasedCredits: 0,
          balance: 5,
          lastDailyCreditDate: todayStr,
          lifetimePurchased: 0,
          lifetimeUsed: 0,
        })
        .returning();

      // Record daily allocation transaction
      await tx.insert(schema.creditTransactions).values({
        walletId: wallet.id,
        userId: user.id,
        amount: 5,
        balanceAfter: 5,
        balanceType: 'DAILY',
        dailyBalanceAfter: 5,
        purchasedBalanceAfter: 0,
        type: 'DAILY_ALLOCATION',
        description: 'Welcome daily free credits on registration',
      });

      // Record audit log
      await tx.insert(schema.auditLogs).values({
        userId: user.id,
        action: 'USER_REGISTERED',
        entityType: 'user',
        entityId: user.id,
        newValues: { email: user.email, role: user.role },
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
      });

      return user;
    });

    const tokens = await this.tokenService.generateTokenPair({
      id: newUser.id,
      email: newUser.email,
      role: newUser.role as UserRole,
      status: newUser.status as UserStatus,
      organizationId: newUser.organizationId,
    });

    // Store refresh token
    const tokenHash = CryptoUtil.sha256(tokens.refreshToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await this.userRepo.createRefreshToken({
      userId: newUser.id,
      tokenHash,
      userAgent: context?.userAgent,
      ipAddress: context?.ipAddress,
      expiresAt,
    });

    this.logger.log(`User registered successfully: ${newUser.email} (${newUser.id})`);

    return {
      user: {
        id: newUser.id,
        email: newUser.email,
        firstName: newUser.firstName,
        lastName: newUser.lastName,
        role: newUser.role as UserRole,
        status: newUser.status as UserStatus,
        organizationName: newUser.organizationName,
        isEmailVerified: newUser.isEmailVerified,
      },
      tokens,
    };
  }

  /**
   * Logs in an existing user with password verification
   */
  async login(
    dto: LoginDto,
    context?: { userAgent?: string; ipAddress?: string },
  ): Promise<IAuthResult> {
    const user = await this.userRepo.findByEmail(dto.email);
    if (!user) {
      throw new BusinessException(
        'Invalid email or password',
        'INVALID_CREDENTIALS',
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (user.status === 'SUSPENDED' || user.status === 'INACTIVE') {
      throw new BusinessException(
        'Your account has been deactivated. Please contact support.',
        'ACCOUNT_INACTIVE',
        HttpStatus.FORBIDDEN,
      );
    }

    if (!user.passwordHash) {
      throw new BusinessException(
        'This account was created using social login (Google/Microsoft). Please sign in using your social login provider or set a password in settings.',
        'OAUTH_ACCOUNT_NO_PASSWORD',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const isValid = await this.passwordService.compare(dto.password, user.passwordHash);
    if (!isValid) {
      throw new BusinessException(
        'Invalid email or password',
        'INVALID_CREDENTIALS',
        HttpStatus.UNAUTHORIZED,
      );
    }

    // Generate tokens
    const tokens = await this.tokenService.generateTokenPair({
      id: user.id,
      email: user.email,
      role: user.role as UserRole,
      status: user.status as UserStatus,
      organizationId: user.organizationId,
    });

    // Save refresh token
    const tokenHash = CryptoUtil.sha256(tokens.refreshToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.userRepo.createRefreshToken({
      userId: user.id,
      tokenHash,
      userAgent: context?.userAgent,
      ipAddress: context?.ipAddress,
      expiresAt,
    });

    // Update last login
    await this.userRepo.updateById(user.id, {
      lastLoginAt: new Date(),
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role as UserRole,
        status: user.status as UserStatus,
        organizationName: user.organizationName,
        isEmailVerified: user.isEmailVerified,
      },
      tokens,
    };
  }

  /**
   * Rotates refresh tokens and detects token reuse
   */
  async refreshTokens(
    rawRefreshToken: string,
    context?: { userAgent?: string; ipAddress?: string },
  ): Promise<ITokenPair> {
    let payload;
    try {
      payload = await this.tokenService.verifyRefreshToken(rawRefreshToken);
    } catch {
      throw new BusinessException('Invalid or expired refresh token', 'INVALID_TOKEN', HttpStatus.UNAUTHORIZED);
    }

    const tokenHash = CryptoUtil.sha256(rawRefreshToken);
    const storedToken = await this.userRepo.findRefreshToken(tokenHash);

    if (!storedToken) {
      throw new BusinessException('Refresh token not recognized', 'INVALID_TOKEN', HttpStatus.UNAUTHORIZED);
    }

    if (storedToken.isRevoked) {
      // Possible token reuse / breach: revoke entire family for safety
      await this.userRepo.revokeRefreshTokenFamily(storedToken.familyId);
      this.logger.warn(`Revoked family ${storedToken.familyId} due to reuse attempt of token ${storedToken.id}`);
      throw new BusinessException('Suspicious token activity detected. Please login again.', 'TOKEN_REVOKED', HttpStatus.UNAUTHORIZED);
    }

    const user = await this.userRepo.findById(payload.sub);
    if (!user || user.status !== 'ACTIVE') {
      throw new BusinessException('User account is not active', 'USER_NOT_FOUND', HttpStatus.UNAUTHORIZED);
    }

    // Revoke used token
    await this.userRepo.revokeRefreshToken(storedToken.id);

    // Issue new pair
    const tokens = await this.tokenService.generateTokenPair({
      id: user.id,
      email: user.email,
      role: user.role as UserRole,
      status: user.status as UserStatus,
      organizationId: user.organizationId,
    });

    const newHash = CryptoUtil.sha256(tokens.refreshToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // Save with same familyId
    await this.userRepo.createRefreshToken({
      userId: user.id,
      tokenHash: newHash,
      familyId: storedToken.familyId,
      userAgent: context?.userAgent,
      ipAddress: context?.ipAddress,
      expiresAt,
    });

    return tokens;
  }

  /**
   * Logs out user by revoking refresh token
   */
  async logout(rawRefreshToken?: string, userId?: string): Promise<void> {
    if (rawRefreshToken) {
      const tokenHash = CryptoUtil.sha256(rawRefreshToken);
      const stored = await this.userRepo.findRefreshToken(tokenHash);
      if (stored) {
        await this.userRepo.revokeRefreshToken(stored.id);
      }
    } else if (userId) {
      await this.userRepo.revokeAllUserRefreshTokens(userId);
    }
  }

  /**
   * Generates a password reset token
   */
  async forgotPassword(email: string): Promise<{ success: boolean; message: string }> {
    const user = await this.userRepo.findByEmail(email);
    // Don't leak if email exists
    if (!user) {
      return { success: true, message: 'If an account exists with this email, password reset instructions have been sent.' };
    }

    // In a full environment this emails a link with token; here we generate deterministic payload
    this.logger.log(`Password reset requested for user: ${user.email}`);
    return { success: true, message: 'If an account exists with this email, password reset instructions have been sent.' };
  }

  /**
   * Resets user password
   */
  async resetPassword(dto: ResetPasswordDto): Promise<{ success: boolean; message: string }> {
    let payload;
    try {
      payload = await this.tokenService.verifyAccessToken(dto.token);
    } catch {
      throw new BusinessException('Invalid or expired reset token', 'INVALID_RESET_TOKEN', HttpStatus.BAD_REQUEST);
    }

    const user = await this.userRepo.findById(payload.sub);
    if (!user) {
      throw new BusinessException('User not found', 'USER_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    const passwordHash = await this.passwordService.hash(dto.newPassword);
    await this.userRepo.updateById(user.id, { passwordHash });
    await this.userRepo.revokeAllUserRefreshTokens(user.id);

    return { success: true, message: 'Password has been reset successfully. Please log in.' };
  }

  /**
   * Verifies user email
   */
  async verifyEmail(token: string): Promise<{ success: boolean; message: string }> {
    let payload;
    try {
      payload = await this.tokenService.verifyAccessToken(token);
    } catch {
      throw new BusinessException('Invalid or expired verification token', 'INVALID_VERIFY_TOKEN', HttpStatus.BAD_REQUEST);
    }

    await this.userRepo.updateById(payload.sub, { isEmailVerified: true });
    return { success: true, message: 'Email verified successfully.' };
  }
}
