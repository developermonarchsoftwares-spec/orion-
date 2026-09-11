import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { CreditRepository } from './credit.repository';
import { CreditService } from './credit.service';

@Injectable()
export class CreditScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CreditScheduler.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly creditRepo: CreditRepository,
    private readonly creditService: CreditService,
  ) {}

  onModuleInit() {
    this.logger.log('CreditScheduler initialized. Starting daily credit rollover worker...');
    // Initial check after 10 seconds
    setTimeout(() => this.runDailyRollover(), 10000);

    // Check hourly for midnight date rollover across timezones
    this.timer = setInterval(() => this.runDailyRollover(), 60 * 60 * 1000);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runDailyRollover() {
    try {
      const todayStr = new Date().toISOString().slice(0, 10);
      const walletsToReset = await this.creditRepo.findWalletsNeedingDailyReset(todayStr, 200);

      if (walletsToReset.length > 0) {
        this.logger.log(`Found ${walletsToReset.length} wallets needing daily credit rollover for ${todayStr}`);
        for (const wallet of walletsToReset) {
          try {
            await this.creditService.syncDailyCredits(wallet.userId);
          } catch (err: any) {
            this.logger.error(`Failed to rollover daily credits for wallet ${wallet.id}: ${err.message}`);
          }
        }
      }
    } catch (error: any) {
      this.logger.error(`Error in runDailyRollover: ${error.message}`);
    }
  }
}
