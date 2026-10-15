import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { IRefreshTokenPayload } from '@orion/shared';

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(configService: ConfigService) {
    const secret = configService.getOrThrow<string>('jwt.refreshSecret'); // no built-in fallback
    const issuer = configService.get<string>('jwt.issuer') || 'orion-api';
    const audience = configService.get<string>('jwt.audience') || 'orion-client';

    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request) => {
          return req?.body?.refreshToken || req?.headers['x-refresh-token'] || null;
        },
      ]),
      ignoreExpiration: false,
      secretOrKey: secret,
      algorithms: ['HS256'],
      passReqToCallback: true,
      issuer,
      audience,
    });
  }

  async validate(req: Request, payload: IRefreshTokenPayload): Promise<IRefreshTokenPayload & { rawToken: string }> {
    const rawToken = req?.body?.refreshToken || (req?.headers['x-refresh-token'] as string);
    if (!rawToken || !payload.sub || !payload.tokenId) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    return {
      ...payload,
      rawToken,
    };
  }
}
