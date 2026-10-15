import { Injectable, Inject, OnModuleDestroy } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DRIZZLE_DATABASE, PG_POOL } from '../../../database/database.constants';
import { DatabaseService } from '../../../database/database.service';
import { CreditScheduler } from '../credit.scheduler';

/** Regression for the staging E2E run: the rollover worker used the pool after the application had closed it. */
const wallets = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `w${i}`, userId: `u${i}` }));
const tick = () => new Promise((r) => setTimeout(r, 5));

describe('CreditScheduler lifecycle', () => {
  afterEach(() => jest.useRealTimers());

  it('the initial 10-second timer is cleared on destroy (it used to be an unreferenced setTimeout)', async () => {
    jest.useFakeTimers();
    const repo = { findWalletsNeedingDailyReset: jest.fn().mockResolvedValue([]) };
    const scheduler = new CreditScheduler(repo as any, { syncDailyCredits: jest.fn() } as any);
    scheduler.onModuleInit();
    await scheduler.onModuleDestroy();
    jest.advanceTimersByTime(2 * 60 * 60 * 1000); // past the 10 s timer and two hourly ticks
    expect(repo.findWalletsNeedingDailyReset).not.toHaveBeenCalled();
  });

  it('a rollover in progress stops between wallets and destroy waits for the wallet being processed', async () => {
    const synced: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const service = {
      syncDailyCredits: jest.fn(async (userId: string) => {
        synced.push(userId);
        if (synced.length === 1) await gate; // the first wallet is "in flight" while shutdown begins
      }),
    };
    const scheduler = new CreditScheduler({ findWalletsNeedingDailyReset: jest.fn().mockResolvedValue(wallets(5)) } as any, service as any);
    const run = scheduler.runDailyRollover();
    await tick();
    let destroyed = false;
    const destroying = scheduler.onModuleDestroy().then(() => (destroyed = true));
    await tick();
    expect(destroyed).toBe(false); // waiting for the in-flight wallet
    release();
    await destroying;
    await run;
    expect(synced).toEqual(['u0']); // wallets 1..4 were never started
  });

  it('after destroy a new rollover does nothing', async () => {
    const repo = { findWalletsNeedingDailyReset: jest.fn().mockResolvedValue(wallets(3)) };
    const scheduler = new CreditScheduler(repo as any, { syncDailyCredits: jest.fn() } as any);
    await scheduler.onModuleDestroy();
    await scheduler.runDailyRollover();
    expect(repo.findWalletsNeedingDailyReset).not.toHaveBeenCalled();
  });
});

describe('shutdown ordering: the pool is ended once, after every onModuleDestroy has finished', () => {
  it('a worker that is still finishing in onModuleDestroy can use the pool; the pool ends afterwards, exactly once', async () => {
    const pool = { end: jest.fn().mockResolvedValue(undefined) };
    const events: string[] = [];

    @Injectable()
    class SlowWorker implements OnModuleDestroy {
      constructor(@Inject(PG_POOL) private readonly p: typeof pool) {}
      async onModuleDestroy() {
        await new Promise((r) => setTimeout(r, 30)); // like a rollover finishing its current wallet
        events.push(`worker done, pool.end calls so far: ${this.p.end.mock.calls.length}`);
      }
    }

    const module = await Test.createTestingModule({
      providers: [
        { provide: PG_POOL, useValue: pool },
        { provide: DRIZZLE_DATABASE, useValue: {} },
        DatabaseService,
        SlowWorker,
      ],
    }).compile();
    const app = module.createNestApplication();
    await app.init();
    await app.close();
    expect(events).toEqual(['worker done, pool.end calls so far: 0']);
    expect(pool.end).toHaveBeenCalledTimes(1);
    await module.get(DatabaseService).onApplicationShutdown(); // a repeated shutdown signal is harmless
    expect(pool.end).toHaveBeenCalledTimes(1);
  });
});
