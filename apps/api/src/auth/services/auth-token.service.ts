import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { IJwtPayload, IRefreshTokenPayload, UserRole, UserStatus } from '@orion/shared';
import { CryptoUtil } from '../../common/utils/crypto.util';
import { randomUUID, randomBytes, createHmac } from 'crypto';

/** Purposes for single-use, purpose-bound tokens (password reset, email verification, MFA login challenge). */
export type TokenPurpose = 'password-reset' | 'email-verify' | 'mfa-login';

export interface ITokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

@Injectable()
export class AuthTokenService {
  private readonly logger = new Logger(AuthTokenService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Generates a signed JWT Access Token
   */
  async generateAccessToken(payload: {
    userId: string;
    email: string;
    role: UserRole;
    status: UserStatus;
    organizationId?: string | null;
    sessionId?: string;
  }): Promise<string> {
    const jwtPayload: IJwtPayload = {
      sub: payload.userId,
      email: payload.email,
      role: payload.role,
      status: payload.status,
      organizationId: payload.organizationId,
      sessionId: payload.sessionId,
    };

    const secret = this.configService.get<string>('jwt.accessSecret');
    const expiresIn = this.configService.get<string>('jwt.accessExpiresIn', '15m');
    const issuer = this.configService.get<string>('jwt.issuer', 'orion-api');
    const audience = this.configService.get<string>('jwt.audience', 'orion-client');

    return this.jwtService.signAsync(jwtPayload, {
      secret,
      expiresIn: expiresIn as any,
      issuer,
      audience,
    });
  }

  /**
   * Generates a signed Refresh Token with a unique Token ID
   */
  async generateRefreshToken(userId: string): Promise<{ token: string; tokenId: string; tokenHash: string }> {
    const tokenId = randomUUID();
    const payload: IRefreshTokenPayload = {
      sub: userId,
      tokenId,
    };

    const secret = this.configService.get<string>('jwt.refreshSecret');
    const expiresIn = this.configService.get<string>('jwt.refreshExpiresIn', '7d');
    const issuer = this.configService.get<string>('jwt.issuer', 'orion-api');
    const audience = this.configService.get<string>('jwt.audience', 'orion-client');

    const token = await this.jwtService.signAsync(payload, {
      secret,
      expiresIn: expiresIn as any,
      issuer,
      audience,
    });

    const tokenHash = CryptoUtil.sha256(token);

    return {
      token,
      tokenId,
      tokenHash,
    };
  }

  /**
   * Generates both Access and Refresh tokens
   */
  async generateTokenPair(user: {
    id: string;
    email: string;
    role: UserRole;
    status: UserStatus;
    organizationId?: string | null;
    sessionId?: string;
  }): Promise<ITokenPair> {
    const accessToken = await this.generateAccessToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      organizationId: user.organizationId,
      sessionId: user.sessionId,
    });

    const { token: refreshToken } = await this.generateRefreshToken(user.id);

    return {
      accessToken,
      refreshToken,
      expiresIn: 900, // 15 minutes in seconds
      tokenType: 'Bearer',
    };
  }

  /**
   * Verifies an Access Token.
   * S-07: an access token must carry no non-access `typ`/`type` claim. This stops a purpose token (password
   * reset / email verification) from ever being replayed as an access token to authenticate API calls.
   */
  async verifyAccessToken(token: string): Promise<IJwtPayload> {
    const secret = this.configService.get<string>('jwt.accessSecret');
    const issuer = this.configService.get<string>('jwt.issuer');
    const audience = this.configService.get<string>('jwt.audience');

    const payload = await this.jwtService.verifyAsync<IJwtPayload & { typ?: string; type?: string }>(token, {
      secret,
      issuer,
      audience,
    });
    const typ = (payload as any).typ ?? (payload as any).type;
    if (typ && typ !== 'access' && typ !== 'ACCESS') {
      throw new Error('Not an access token');
    }
    return payload;
  }

  /**
   * S-07: a purpose-bound token (password reset, email verification) is signed with a secret DERIVED from the
   * access secret for that purpose, so it can never be verified as an access or refresh token, and carries a
   * matching `typ`. Verification requires both the derived secret and the exact purpose.
   */
  private purposeSecret(purpose: TokenPurpose): string {
    const base = this.configService.get<string>('jwt.accessSecret') || '';
    return createHmac('sha256', base).update(`orion:${purpose}`).digest('hex');
  }

  async generatePurposeToken(purpose: TokenPurpose, sub: string, email: string, expiresIn = '15m'): Promise<string> {
    const issuer = this.configService.get<string>('jwt.issuer', 'orion-api');
    const audience = this.configService.get<string>('jwt.audience', 'orion-client');
    return this.jwtService.signAsync(
      { sub, email, typ: purpose },
      { secret: this.purposeSecret(purpose), expiresIn: expiresIn as any, issuer, audience },
    );
  }

  async verifyPurposeToken(purpose: TokenPurpose, token: string): Promise<{ sub: string; email?: string }> {
    const issuer = this.configService.get<string>('jwt.issuer');
    const audience = this.configService.get<string>('jwt.audience');
    const payload = await this.jwtService.verifyAsync<{ sub?: string; email?: string; typ?: string }>(token, {
      secret: this.purposeSecret(purpose),
      issuer,
      audience,
    });
    if (!payload?.sub || payload.typ !== purpose) {
      throw new Error('Invalid purpose token');
    }
    return { sub: payload.sub, email: payload.email };
  }

  /** Refresh-token lifetime in ms, from JWT_REFRESH_EXPIRES_IN (e.g. `7d`, `12h`, `30m`, or plain seconds). */
  refreshTtlMs(): number {
    const raw = String(this.configService.get<string>('jwt.refreshExpiresIn', '7d')).trim();
    const m = /^(\d+)\s*(s|m|h|d)?$/i.exec(raw);
    if (!m) return 7 * 24 * 60 * 60 * 1000;
    const unit = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[(m[2] || 's').toLowerCase() as 's' | 'm' | 'h' | 'd'];
    return Number(m[1]) * unit;
  }

  /** Opaque 256-bit URL-safe token for single-use e-mail links; only its SHA-256 is ever stored. */
  generateOpaqueToken(): { token: string; hash: string } {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: CryptoUtil.sha256(token) };
  }

  /**
   * Verifies a Refresh Token
   */
  async verifyRefreshToken(token: string): Promise<IRefreshTokenPayload> {
    const secret = this.configService.get<string>('jwt.refreshSecret');
    const issuer = this.configService.get<string>('jwt.issuer');
    const audience = this.configService.get<string>('jwt.audience');

    return this.jwtService.verifyAsync<IRefreshTokenPayload>(token, {
      secret,
      issuer,
      audience,
    });
  }
}
