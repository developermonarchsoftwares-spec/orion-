import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { IJwtPayload, IRefreshTokenPayload, UserRole, UserStatus } from '@orion/shared';
import { CryptoUtil } from '../../common/utils/crypto.util';
import { randomUUID } from 'crypto';

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
   * Verifies an Access Token
   */
  async verifyAccessToken(token: string): Promise<IJwtPayload> {
    const secret = this.configService.get<string>('jwt.accessSecret');
    const issuer = this.configService.get<string>('jwt.issuer');
    const audience = this.configService.get<string>('jwt.audience');

    return this.jwtService.verifyAsync<IJwtPayload>(token, {
      secret,
      issuer,
      audience,
    });
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
