import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { backgroundJobDisabled } from '../../common/utils/restore-mode';
import { ExportService } from './export.service';

/**
 * Runs due scheduled exports once a minute and removes expired export files. Several API instances may run this: each schedule
 * is claimed with a compare-and-set in ExportService, so it still runs once. Off under NODE_ENV=test or DISABLE_EXPORT_SCHEDULER=true.
 */
@Injectable()
export class ExportSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ExportSchedulerService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly exports: ExportService) {}

  onModuleInit() {
    if (backgroundJobDisabled('DISABLE_EXPORT_SCHEDULER')) return;
    this.timer = setInterval(() => void this.tick(), 60_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass. Never throws; overlapping passes are skipped. */
  async tick(): Promise<{ ran: number; failed: number; purged: number }> {
    if (this.running) return { ran: 0, failed: 0, purged: 0 };
    this.running = true;
    try {
      const { ran, failed } = await this.exports.runDueSchedules();
      const purged = await this.exports.purgeExpired();
      if (ran || failed || purged) this.logger.log(`Scheduled exports: ${ran} ran, ${failed} failed, ${purged} expired file(s) removed`);
      return { ran, failed, purged };
    } catch (err) {
      this.logger.error(`Export scheduler pass failed: ${(err as Error).message}`);
      return { ran: 0, failed: 0, purged: 0 };
    } finally {
      this.running = false;
    }
  }
}
