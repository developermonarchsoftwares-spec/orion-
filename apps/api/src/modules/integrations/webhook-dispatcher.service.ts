import { HttpStatus, Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { and, eq, inArray, lte } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { BusinessException } from '../../common/errors/business.exception';
import { DRIZZLE_DATABASE } from '../../database/database.constants';
import { DrizzleDb } from '../../database/database.provider';
import * as schema from '../../database/schema';
import { MAX_DELIVERY_ATTEMPTS, RETRY_BACKOFF_MS, signPayload } from './integration.constants';
import { IntegrationsService } from './integrations.service';
import { safeRequest } from './net/safe-http';
import { backgroundJobDisabled } from '../../common/utils/restore-mode';

type IntegrationRow = typeof schema.integrations.$inferSelect;
/** A delivery that is picked up is leased for this long, so a crash mid-delivery just means a later retry. */
const LEASE_MS = 2 * 60_000;

export interface IDeliveryResult {
  ok: boolean;
  statusCode?: number;
  error?: string;
  durationMs?: number;
}

/**
 * Sends queued webhook deliveries: signed, one attempt at a time, with growing waits between attempts (30 s, 2 min, 10 min, 1 h, 6 h),
 * then DEAD. Every attempt is recorded on the delivery and reported to IntegrationsService (failure counters, auto-disable). With several
 * API instances each delivery is claimed by moving its next_attempt_at (compare-and-set), so it is sent by exactly one of them.
 * The ticker is off under NODE_ENV=test and with DISABLE_INTEGRATION_DISPATCHER=true.
 */
@Injectable()
export class WebhookDispatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookDispatcherService.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private tickCount = 0;

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: DrizzleDb,
    private readonly integrations: IntegrationsService,
  ) {}

  onModuleInit() {
    if (backgroundJobDisabled('DISABLE_INTEGRATION_DISPATCHER')) return;
    this.timer = setInterval(() => void this.tick(), 5_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private callbackUrl(integrationId: string): string {
    const base = (process.env.API_PUBLIC_URL || process.env.APP_URL || '').replace(/\/+$/, '');
    const prefix = (process.env.API_PREFIX || '/api/v1').replace(/\/+$/, '');
    return `${base}${prefix}/integrations/callbacks/${integrationId}`;
  }

  /** Queues an event for one webhook. The payload carries ids and counts only. */
  async enqueue(integration: IntegrationRow, event: string, data: Record<string, unknown>) {
    const [row] = await this.db
      .insert(schema.integrationDeliveries)
      .values({
        integrationId: integration.id,
        userId: integration.userId,
        event,
        payload: { id: randomUUID(), type: event, createdAt: new Date().toISOString(), data },
      })
      .returning();
    return row;
  }

  /** One attempt, now. Updates the delivery and the integration's health. */
  async deliver(deliveryId: string): Promise<IDeliveryResult> {
    const [d] = await this.db.select().from(schema.integrationDeliveries).where(eq(schema.integrationDeliveries.id, deliveryId)).limit(1);
    if (!d) return { ok: false, error: 'delivery not found' };
    const [integ] = await this.db.select().from(schema.integrations).where(eq(schema.integrations.id, d.integrationId)).limit(1);
    const isTest = d.event === 'integration.test';
    if (!integ || !integ.targetUrl || (!isTest && integ.status !== 'ACTIVE')) {
      await this.db.update(schema.integrationDeliveries).set({ status: 'DEAD', lastError: 'integration not active' }).where(eq(schema.integrationDeliveries.id, d.id));
      return { ok: false, error: 'integration not active' };
    }

    const body = JSON.stringify({ ...(d.payload as object), deliveryId: d.id, callbackUrl: this.callbackUrl(integ.id) });
    let result: IDeliveryResult;
    try {
      const res = await safeRequest(integ.targetUrl, {
        method: 'POST',
        body,
        headers: {
          'content-type': 'application/json',
          'user-agent': 'Orion-Webhooks/1.0',
          'x-orion-event': d.event,
          'x-orion-delivery': d.id,
          'x-orion-signature': signPayload(this.integrations.signingSecretOf(integ), body),
        },
      });
      result = res.status >= 200 && res.status < 300 ? { ok: true, statusCode: res.status, durationMs: res.durationMs } : { ok: false, statusCode: res.status, durationMs: res.durationMs, error: `HTTP ${res.status}` };
    } catch (err) {
      result = { ok: false, error: String((err as Error)?.message ?? err).slice(0, 300) };
    }

    const attempts = d.attempts + 1;
    const gone = result.statusCode === 410;
    const exhausted = !result.ok && (gone || attempts >= MAX_DELIVERY_ATTEMPTS);
    await this.db
      .update(schema.integrationDeliveries)
      .set({
        attempts,
        status: result.ok ? 'SUCCEEDED' : exhausted ? 'DEAD' : 'FAILED',
        nextAttemptAt: result.ok || exhausted ? d.nextAttemptAt : new Date(Date.now() + RETRY_BACKOFF_MS[Math.min(attempts - 1, RETRY_BACKOFF_MS.length - 1)]),
        lastStatusCode: result.statusCode ?? null,
        lastError: result.ok ? null : (result.error ?? null),
        durationMs: result.durationMs ?? null,
        deliveredAt: result.ok ? new Date() : null,
      })
      .where(eq(schema.integrationDeliveries.id, d.id));
    // a manual test says nothing about the health of the real traffic
    if (!isTest) await this.integrations.recordOutcome(integ.id, result.ok, result.error, gone ? 'endpoint returned 410 Gone' : undefined);
    return result;
  }

  /** Sends a test ping to the owner's endpoint and returns what happened. */
  async sendTest(userId: string, integrationId: string): Promise<IDeliveryResult & { deliveryId: string }> {
    const integ = await this.integrations.getOwned(userId, integrationId);
    if (integ.type !== 'WEBHOOK') throw new BusinessException('Only a webhook can be pinged', 'NOT_A_WEBHOOK', HttpStatus.BAD_REQUEST);
    const d = await this.enqueue(integ, 'integration.test', { message: 'This is a test event from Orion.' });
    // not left for the retry loop: the owner wants the answer now, and a failed ping is just reported
    await this.db.update(schema.integrationDeliveries).set({ nextAttemptAt: new Date(Date.now() + LEASE_MS) }).where(eq(schema.integrationDeliveries.id, d.id));
    const r = await this.deliver(d.id);
    if (!r.ok) await this.db.update(schema.integrationDeliveries).set({ status: 'DEAD' }).where(eq(schema.integrationDeliveries.id, d.id));
    return { ...r, deliveryId: d.id };
  }

  /** One pass over the due deliveries. Never throws; overlapping passes are skipped. */
  async tick(now = new Date()): Promise<{ attempted: number; succeeded: number; purged: number }> {
    if (this.running) return { attempted: 0, succeeded: 0, purged: 0 };
    this.running = true;
    try {
      const due = await this.db
        .select({ id: schema.integrationDeliveries.id, nextAttemptAt: schema.integrationDeliveries.nextAttemptAt })
        .from(schema.integrationDeliveries)
        .where(and(inArray(schema.integrationDeliveries.status, ['PENDING', 'FAILED']), lte(schema.integrationDeliveries.nextAttemptAt, now)))
        .orderBy(schema.integrationDeliveries.nextAttemptAt)
        .limit(20);
      let attempted = 0;
      let succeeded = 0;
      for (const item of due) {
        const claimed = await this.db
          .update(schema.integrationDeliveries)
          .set({ nextAttemptAt: new Date(now.getTime() + LEASE_MS) })
          .where(and(eq(schema.integrationDeliveries.id, item.id), eq(schema.integrationDeliveries.nextAttemptAt, item.nextAttemptAt), inArray(schema.integrationDeliveries.status, ['PENDING', 'FAILED'])))
          .returning({ id: schema.integrationDeliveries.id });
        if (!claimed.length) continue;
        attempted++;
        if ((await this.deliver(item.id)).ok) succeeded++;
      }
      // housekeeping once in a while
      let purged = 0;
      if (++this.tickCount % 720 === 0) purged = await this.integrations.purgeOldDeliveries();
      return { attempted, succeeded, purged };
    } catch (err) {
      this.logger.error(`Webhook dispatch pass failed: ${(err as Error).message}`);
      return { attempted: 0, succeeded: 0, purged: 0 };
    } finally {
      this.running = false;
    }
  }
}
