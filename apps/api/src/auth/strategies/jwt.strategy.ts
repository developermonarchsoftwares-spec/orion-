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
    const secret = configService.getOrThrow<string>('jwt.accessSecret'); // no built-in fallback
    const issuer = configService.get<string>('jwt.issuer') || 'orion-api';
    const audience = configService.get<string>('jwt.audience') || 'orion-client';

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
      algorithms: ['HS256'],
      issuer,
      audience,
    });
  }

  async validate(payload: IJwtPayload & { typ?: string; type?: string }): Promise<IJwtPayload> {
    if (!payload.sub || !payload.email) {
      throw new UnauthorizedException('Invalid token payload');
    }

    // S-07: a purpose token (password reset / email verify) or a refresh token must never authenticate an API
    // call, even if it were somehow signed with the access secret.
    const typ = payload.typ ?? payload.type;
    if (typ && typ !== 'access' && typ !== 'ACCESS') {
      throw new UnauthorizedException('Invalid token type');
    }

    // S-08: authorise against the PERSISTED status, not only the claim captured when the token was minted, so a
    // user suspended after login is rejected on their very next request. One lookup also serves the session check.
    const user = await this.userRepo.findById(payload.sub);
    if (!user || user.status === UserStatus.SUSPENDED || user.status === UserStatus.INACTIVE) {
      throw new UnauthorizedException('User account is inactive or suspended');
    }

    // Single-Device Login Enforcement Check (Netflix-Style)
    if (payload.sessionId) {
      const activeSessionId = (user.metadata as Record<string, any>)?.activeSessionId;
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

