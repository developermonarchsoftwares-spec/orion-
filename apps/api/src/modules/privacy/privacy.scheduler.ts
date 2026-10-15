import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrivacyService } from './privacy.service';
import { backgroundJobDisabled } from '../../common/utils/restore-mode';

/** Hourly: erase accounts whose cooling-off period ended, and apply the retention schedule. Off under NODE_ENV=test. */
@Injectable()
export class PrivacyScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrivacyScheduler.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly privacy: PrivacyService) {}

  onModuleInit() {
    if (backgroundJobDisabled('DISABLE_PRIVACY_JOBS')) return;
    this.timer = setInterval(() => void this.run(), 60 * 60 * 1000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const erased = await this.privacy.runDueDeletions();
      const purged = await this.privacy.enforceRetention();
      if (erased || Object.values(purged).some(Boolean)) this.logger.log(`Erased ${erased} account(s); retention: ${JSON.stringify(purged)}`);
    } catch (err) {
      this.logger.error(`Privacy job failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
