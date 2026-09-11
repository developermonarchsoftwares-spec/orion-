import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { AuthTokenService } from './services/auth-token.service';

@Injectable()
export class AuthenticationMiddleware implements NestMiddleware {
  private readonly logger = new Logger(AuthenticationMiddleware.name);

  constructor(private readonly tokenService: AuthTokenService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      try {
        const payload = await this.tokenService.verifyAccessToken(token);
         
        (req as any).user = payload;
      } catch {
        // Token invalid or expired - guard will handle enforcement if endpoint is not public
      }
    }
    next();
  }
}
