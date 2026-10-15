import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AuthService } from './auth.service';
import { backgroundJobDisabled } from '../../common/utils/restore-mode';

/** Hourly purge of expired / long-revoked refresh tokens and stale single-use action tokens. Off under NODE_ENV=test. */
@Injectable()
export class TokenCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TokenCleanupService.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly authService: AuthService) {}

  onModuleInit() {
    if (backgroundJobDisabled('DISABLE_TOKEN_CLEANUP')) return;
    this.timer = setInterval(() => void this.run(), 60 * 60 * 1000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async run(): Promise<number> {
    try {
      const n = await this.authService.purgeStaleTokens();
      if (n) this.logger.log(`Purged ${n} stale refresh token(s)`);
      return n;
    } catch (err) {
      this.logger.error(`Token cleanup failed: ${(err as Error).message}`);
      return 0;
    }
  }
}
