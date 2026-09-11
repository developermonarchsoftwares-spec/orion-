import { Injectable, Logger, HttpStatus, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IOAuthProvider, IOAuthUserProfile } from './interfaces/oauth-provider.interface';
import { GoogleOAuthProvider } from './providers/google.provider';
import { MicrosoftOAuthProvider } from './providers/microsoft.provider';
import { OAuthStateService } from './services/oauth-state.service';
import { UserRepository } from '../user/user.repository';
import { AuthTokenService, ITokenPair } from '../../auth/services/auth-token.service';
import { BusinessException } from '../../common/errors/business.exception';
import { CryptoUtil } from '../../common/utils/crypto.util';
import { DRIZZLE_DATABASE } from '../../database/database.constants';
import { DrizzleDb } from '../../database/database.provider';
import * as schema from '../../database/schema';
import { eq } from 'drizzle-orm';
import { UserRole, UserStatus } from '@orion/shared';

export interface IOAuthAuthResult {
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    displayName?: string | null;
    avatarUrl?: string | null;
    role: UserRole;
    status: UserStatus;
    provider: string;
    googleLinked: boolean;
    microsoftLinked: boolean;
    hasPassword: boolean;
    isEmailVerified: boolean;
  };
  tokens: ITokenPair;
  isNewUser: boolean;
  linkedExisting: boolean;
}

@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);
  private readonly providers = new Map<string, IOAuthProvider>();

  constructor(
    private readonly configService: ConfigService,
    private readonly googleProvider: GoogleOAuthProvider,
    private readonly microsoftProvider: MicrosoftOAuthProvider,
    private readonly stateService: OAuthStateService,
    private readonly userRepo: UserRepository,
    private readonly tokenService: AuthTokenService,
    @Inject(DRIZZLE_DATABASE)
    private readonly db: DrizzleDb,
  ) {
    this.providers.set('GOOGLE', this.googleProvider);
    this.providers.set('MICROSOFT', this.microsoftProvider);
  }

  /**
   * Generates redirect URL with secure PKCE and HMAC state token
   */
  getAuthorizationUrl(providerKey: 'google' | 'microsoft', linkUserId?: string): string {
    const provider = this.providers.get(providerKey.toUpperCase());
    if (!provider) {
      throw new BusinessException(`Unsupported OAuth provider: ${providerKey}`, 'INVALID_PROVIDER', HttpStatus.BAD_REQUEST);
    }

    const { state, codeChallenge } = this.stateService.generateState(provider.name, linkUserId);
    return provider.getAuthorizationUrl(state, codeChallenge);
  }

  /**
   * Processes OAuth callback, performs account linking or new provisioning, and returns JWT session
   */
  async handleCallback(
    providerKey: 'google' | 'microsoft',
    code: string,
    state: string,
    context?: { userAgent?: string; ipAddress?: string },
  ): Promise<IOAuthAuthResult> {
    // 1. Verify CSRF state token
    const { valid, payload } = this.stateService.verifyState(state);
    if (!valid || !payload) {
      this.logger.warn(`Invalid or expired OAuth state rejected for ${providerKey}`);
      throw new BusinessException(
        'Invalid or expired OAuth state parameter. Please try signing in again.',
        'INVALID_OAUTH_STATE',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!code || typeof code !== 'string' || code.trim().length === 0) {
      throw new BusinessException(
        'Missing authorization code from OAuth provider.',
        'MISSING_AUTHORIZATION_CODE',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (payload.provider && payload.provider.toUpperCase() !== providerKey.toUpperCase()) {
      this.logger.warn(`Provider mismatch: state was generated for ${payload.provider} but received callback for ${providerKey}`);
      throw new BusinessException(
        'OAuth provider mismatch detected.',
        'PROVIDER_MISMATCH',
        HttpStatus.BAD_REQUEST,
      );
    }

    const provider = this.providers.get(providerKey.toUpperCase());
    if (!provider) {
      throw new BusinessException(`Unsupported OAuth provider: ${providerKey}`, 'INVALID_PROVIDER', HttpStatus.BAD_REQUEST);
    }

    // 2. Exchange authorization code for tokens
    const tokens = await provider.exchangeCode(code, payload.codeVerifier);

    // 3. Retrieve user profile
    const profile = await provider.getUserProfile(tokens.accessToken, tokens.idToken);

    // 4. Handle account linking or provisioning
    let user: any = null;
    let isNewUser = false;
    let linkedExisting = false;

    // Check if initiated from an explicit account linking flow
    if (payload.linkUserId) {
      user = await this.userRepo.findById(payload.linkUserId);
      if (!user) {
        throw new BusinessException('Account linking target user not found', 'USER_NOT_FOUND', HttpStatus.NOT_FOUND);
      }

      if (provider.name === 'GOOGLE') {
        user = await this.userRepo.linkGoogle(user.id, profile.providerId, profile.avatarUrl);
      } else if (provider.name === 'MICROSOFT') {
        user = await this.userRepo.linkMicrosoft(user.id, profile.providerId, profile.avatarUrl);
      }

      linkedExisting = true;
      await this.logAudit(user.id, 'PROVIDER_LINKED', 'user', user.id, { provider: provider.name }, context);
    } else {
      // Standard sign-in / sign-up flow
      // A. Check if user already exists with this specific OAuth provider ID
      if (provider.name === 'GOOGLE') {
        user = await this.userRepo.findByGoogleId(profile.providerId);
      } else if (provider.name === 'MICROSOFT') {
        user = await this.userRepo.findByMicrosoftId(profile.providerId);
      }

      // B. If not found by provider ID, check by email for automatic account linking
      if (!user) {
        const existingByEmail = await this.userRepo.findByEmail(profile.email);

        if (existingByEmail) {
          // Link existing account with zero data loss or duplication
          this.logger.log(`Linking existing user ${existingByEmail.email} with ${provider.name} ID: ${profile.providerId}`);
          if (provider.name === 'GOOGLE') {
            user = await this.userRepo.linkGoogle(existingByEmail.id, profile.providerId, profile.avatarUrl);
          } else {
            user = await this.userRepo.linkMicrosoft(existingByEmail.id, profile.providerId, profile.avatarUrl);
          }

          linkedExisting = true;
          await this.logAudit(user.id, 'ACCOUNT_LINKED', 'user', user.id, { provider: provider.name, email: user.email }, context);
        } else {
          // C. Provision brand new user + wallet + 5 daily credits
          isNewUser = true;
          user = await this.provisionNewOAuthUser(profile, context);
        }
      } else {
        // Existing OAuth user: update last login metadata
        await this.userRepo.updateById(user.id, {
          lastLoginProvider: provider.name,
          lastLoginAt: new Date(),
        });
        await this.logAudit(user.id, 'OAUTH_LOGIN', 'user', user.id, { provider: provider.name }, context);
      }
    }

    if (user.status === 'SUSPENDED' || user.status === 'INACTIVE') {
      throw new BusinessException('Your account is inactive. Please contact support.', 'ACCOUNT_INACTIVE', HttpStatus.FORBIDDEN);
    }

    // 5. Generate JWT token pair
    const jwtTokens = await this.tokenService.generateTokenPair({
      id: user.id,
      email: user.email,
      role: user.role as UserRole,
      status: user.status as UserStatus,
      organizationId: user.organizationId,
    });

    // 6. Store refresh token family
    const tokenHash = CryptoUtil.sha256(jwtTokens.refreshToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.userRepo.createRefreshToken({
      userId: user.id,
      tokenHash,
      userAgent: context?.userAgent,
      ipAddress: context?.ipAddress,
      expiresAt,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        displayName: user.displayName || `${user.firstName} ${user.lastName}`.trim(),
        avatarUrl: user.avatarUrl,
        role: user.role as UserRole,
        status: user.status as UserStatus,
        provider: user.provider,
        googleLinked: Boolean(user.googleId),
        microsoftLinked: Boolean(user.microsoftId),
        hasPassword: Boolean(user.passwordHash && user.passwordHash.length > 0),
        isEmailVerified: user.isEmailVerified,
      },
      tokens: jwtTokens,
      isNewUser,
      linkedExisting,
    };
  }

  /**
   * Atomically provisions a new user, wallet with 5 daily credits, and audit trail
   */
  private async provisionNewOAuthUser(
    profile: IOAuthUserProfile,
    context?: { userAgent?: string; ipAddress?: string },
  ) {
    const todayStr = new Date().toISOString().slice(0, 10);

    return this.db.transaction(async (tx) => {
      // 1. Insert user with null password
      const [newUser] = await tx
        .insert(schema.users)
        .values({
          email: profile.email.toLowerCase().trim(),
          passwordHash: null, // Passwords never exist for OAuth-only users
          firstName: profile.firstName || 'User',
          lastName: profile.lastName || '',
          displayName: profile.displayName || `${profile.firstName} ${profile.lastName}`.trim(),
          role: 'USER',
          status: 'ACTIVE',
          provider: profile.provider,
          googleId: profile.provider === 'GOOGLE' ? profile.providerId : null,
          microsoftId: profile.provider === 'MICROSOFT' ? profile.providerId : null,
          avatarUrl: profile.avatarUrl,
          profilePicture: profile.avatarUrl,
          isEmailVerified: true,
          emailVerifiedAt: new Date(),
          lastLoginProvider: profile.provider,
          lastLoginAt: new Date(),
        })
        .returning();

      // 2. Initialize Wallet with 5 Daily Free Credits
      const [wallet] = await tx
        .insert(schema.userWallets)
        .values({
          userId: newUser.id,
          dailyCredits: 5,
          purchasedCredits: 0,
          balance: 5,
          lastDailyCreditDate: todayStr,
          lifetimePurchased: 0,
          lifetimeUsed: 0,
        })
        .returning();

      // 3. Record welcome daily credit allocation transaction
      await tx.insert(schema.creditTransactions).values({
        walletId: wallet.id,
        userId: newUser.id,
        amount: 5,
        balanceAfter: 5,
        balanceType: 'DAILY',
        dailyBalanceAfter: 5,
        purchasedBalanceAfter: 0,
        type: 'DAILY_ALLOCATION',
        description: `Welcome daily free credits on ${profile.provider} onboarding`,
      });

      // 4. Record audit log
      await tx.insert(schema.auditLogs).values({
        userId: newUser.id,
        action: 'OAUTH_REGISTRATION',
        entityType: 'user',
        entityId: newUser.id,
        newValues: { provider: profile.provider, email: newUser.email },
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
      });

      this.logger.log(`Provisioned new ${profile.provider} user: ${newUser.email} (${newUser.id}) with 5 daily credits`);
      return newUser;
    });
  }

  /**
   * Unlinks an OAuth provider, ensuring user is not locked out
   */
  async unlinkProvider(
    userId: string,
    provider: 'GOOGLE' | 'MICROSOFT',
    context?: { ipAddress?: string; userAgent?: string },
  ) {
    const user = await this.userRepo.findById(userId);
    if (!user) {
      throw new BusinessException('User not found', 'USER_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    const hasPassword = Boolean(user.passwordHash && user.passwordHash.length > 0);
    const hasOtherProvider =
      (provider === 'GOOGLE' && Boolean(user.microsoftId)) ||
      (provider === 'MICROSOFT' && Boolean(user.googleId));

    if (!hasPassword && !hasOtherProvider) {
      throw new BusinessException(
        'Cannot unlink your only sign-in method. Set a password or link another account before disconnecting this provider.',
        'CANNOT_UNLINK_ONLY_PROVIDER',
        HttpStatus.BAD_REQUEST,
      );
    }

    await this.userRepo.unlinkProvider(userId, provider);
    await this.logAudit(userId, 'PROVIDER_UNLINKED', 'user', userId, { provider }, context);

    this.logger.log(`User ${user.email} unlinked provider: ${provider}`);
    return {
      success: true,
      message: `Successfully disconnected ${provider} account`,
    };
  }

  /**
   * Records security audit log entry
   */
  private async logAudit(
    userId: string,
    action: string,
    entityType: string,
    entityId: string,
    metadata?: Record<string, any>,
    context?: { ipAddress?: string; userAgent?: string },
  ) {
    try {
      await this.db.insert(schema.auditLogs).values({
        userId,
        action,
        entityType,
        entityId,
        newValues: metadata,
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
      });
    } catch (err: any) {
      this.logger.warn(`Failed to write audit log: ${err.message}`);
    }
  }
}
