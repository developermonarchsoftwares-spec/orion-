import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { IJwtPayload, UserStatus } from '@orion/shared';
import { UserRepository } from '../../modules/user/user.repository';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService,
    private readonly userRepo: UserRepository,
  ) {
    const secret = configService.get<string>('jwt.accessSecret') || 'orion_access_secret_key_default_2026';
    const issuer = configService.get<string>('jwt.issuer') || 'orion-api';
    const audience = configService.get<string>('jwt.audience') || 'orion-client';

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
      issuer,
      audience,
    });
  }

  async validate(payload: IJwtPayload): Promise<IJwtPayload> {
    if (!payload.sub || !payload.email) {
      throw new UnauthorizedException('Invalid token payload');
    }

    if (payload.status === UserStatus.SUSPENDED || payload.status === UserStatus.INACTIVE) {
      throw new UnauthorizedException('User account is inactive or suspended');
    }

    // Single-Device Login Enforcement Check (Netflix-Style)
    if (payload.sessionId) {
      const user = await this.userRepo.findById(payload.sub);
      const activeSessionId = (user?.metadata as Record<string, any>)?.activeSessionId;
      if (activeSessionId && payload.sessionId !== activeSessionId) {
        throw new UnauthorizedException(
          {
            statusCode: 401,
            code: 'SESSION_SUPERSEDED',
            message: 'Your account has been logged in on another device. Please log in again.',
          },
          'SESSION_SUPERSEDED',
        );
      }
    }

    return payload;
  }
}

