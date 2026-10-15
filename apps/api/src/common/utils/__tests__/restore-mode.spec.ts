import { backgroundJobDisabled, restoreMode } from '../restore-mode';
import { CreditScheduler } from '../../../modules/credit/credit.scheduler';
import { QueueService } from '../../../modules/queue/queue.service';

describe('restore mode (Phase 30)', () => {
  const saved = { mode: process.env.RESTORE_MODE };
  afterEach(() => {
    if (saved.mode === undefined) delete process.env.RESTORE_MODE;
    else process.env.RESTORE_MODE = saved.mode;
  });

  it('is off unless RESTORE_MODE is exactly "true" (any case)', () => {
    for (const v of [undefined, '', 'false', '0', 'yes', '1']) expect(restoreMode({ RESTORE_MODE: v } as any)).toBe(false);
    for (const v of ['true', 'TRUE', ' True ']) expect(restoreMode({ RESTORE_MODE: v } as any)).toBe(true);
  });

  it('switches off every job that has a switch: tests, its own flag, or restore mode', () => {
    expect(backgroundJobDisabled('DISABLE_X', {} as any)).toBe(false);
    expect(backgroundJobDisabled('DISABLE_X', { DISABLE_X: 'true' } as any)).toBe(true);
    expect(backgroundJobDisabled('DISABLE_X', { RESTORE_MODE: 'true' } as any)).toBe(true);
    expect(backgroundJobDisabled('DISABLE_X', { NODE_ENV: 'test' } as any)).toBe(true);
  });

  it('the daily credit rollover starts no timer in restore mode, and does start them otherwise', async () => {
    process.env.RESTORE_MODE = 'true';
    const off = new CreditScheduler({} as any, {} as any);
    off.onModuleInit();
    expect((off as any).timer).toBeNull();
    expect((off as any).initialTimer).toBeNull();
    delete process.env.RESTORE_MODE;
    const on = new CreditScheduler({} as any, {} as any);
    on.onModuleInit();
    expect((on as any).timer).not.toBeNull();
    await on.onModuleDestroy();
  });

  it('a queue worker is not registered in restore mode, so waiting jobs stay waiting', () => {
    process.env.RESTORE_MODE = 'true';
    const q = new QueueService({} as any, {} as any);
    q.registerWorker('people-import', async () => undefined);
    expect((q as any).handlers.size).toBe(0);
    delete process.env.RESTORE_MODE;
    const q2 = new QueueService({} as any, {} as any);
    (q2 as any).processPendingJobs = jest.fn();
    q2.registerWorker('people-import', async () => undefined);
    expect((q2 as any).handlers.size).toBe(1);
  });
});
