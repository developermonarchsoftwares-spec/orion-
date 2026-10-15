import { HttpStatus, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { BusinessException } from '../../common/errors/business.exception';
import { AuditLogService } from '../../common/services/audit-log.service';
import { MailService } from '../../auth/mail/mail.service';
import { openSecret, sealSecret } from '../../auth/services/secret-box.util';
import { DRIZZLE_DATABASE } from '../../database/database.constants';
import { DrizzleDb } from '../../database/database.provider';
import * as schema from '../../database/schema';
import {
  DELIVERY_RETENTION_DAYS,
  DISABLE_AFTER_CONSECUTIVE_FAILURES,
  INTEGRATION_TYPES,
  IntegrationType,
  MAX_INTEGRATIONS_PER_USER,
  newSigningSecret,
  SUBSCRIBABLE_EVENTS,
} from './integration.constants';
import { assertSafeUrl, UnsafeUrlError } from './net/safe-http';

export interface IRequestContext {
  ip?: string | null;
  userAgent?: string | null;
}

export type HealthState = 'HEALTHY' | 'DEGRADED' | 'FAILING' | 'PAUSED' | 'DISABLED';

type IntegrationRow = typeof schema.integrations.$inferSelect;

const rowsOf = (res: any): any[] => (Array.isArray(res) ? res : (res?.rows ?? []));
const trimErr = (e: unknown) => String((e as Error)?.message ?? e ?? 'error').slice(0, 300);

/**
 * Connections to third-party systems: lifecycle, secrets, health and failure monitoring. Delivery itself is in WebhookDispatcherService,
 * CRM sync in CrmSyncService; both report each outcome here (`recordOutcome`), which keeps the failure counters and switches an integration
 * off, and tells its owner, after repeated failures.
 */
@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: DrizzleDb,
    @Optional() private readonly audit?: AuditLogService,
    @Optional() private readonly mail?: MailService,
  ) {}

  // ---------------------------------------------------------------------------------------------------------------
  // Secrets and views
  // ---------------------------------------------------------------------------------------------------------------

  signingSecretOf(row: IntegrationRow): string {
    return openSecret(row.signingSecretEnc, process.env, 'integrations');
  }

  credentialOf(row: IntegrationRow): string | null {
    return row.credentialEnc ? openSecret(row.credentialEnc, process.env, 'integrations') : null;
  }

  /** No secret ever appears in a view. */
  async view(row: IntegrationRow) {
    const health = await this.healthOf(row);
    return {
      id: row.id,
      type: row.type,
      name: row.name,
      status: row.status,
      targetUrl: row.targetUrl,
      events: row.events as string[],
      hasCredential: !!row.credentialEnc,
      health,
      consecutiveFailures: row.consecutiveFailures,
      lastSuccessAt: row.lastSuccessAt,
      lastFailureAt: row.lastFailureAt,
      lastError: row.lastError,
      disabledReason: row.disabledReason,
      lastValidatedAt: row.lastValidatedAt,
      createdAt: row.createdAt,
    };
  }

  async getOwned(userId: string, id: string): Promise<IntegrationRow> {
    const [row] = /^[0-9a-f-]{36}$/i.test(id) ? await this.db.select().from(schema.integrations).where(and(eq(schema.integrations.id, id), eq(schema.integrations.userId, userId))).limit(1) : [];
    if (!row) throw new BusinessException('Integration not found', 'INTEGRATION_NOT_FOUND', HttpStatus.NOT_FOUND);
    return row;
  }

  private async checkUrl(url: string) {
    try {
      return (await assertSafeUrl(url)).toString();
    } catch (err) {
      if (err instanceof UnsafeUrlError) throw new BusinessException(err.message, 'UNSAFE_TARGET_URL', HttpStatus.BAD_REQUEST, { reason: err.code });
      throw err;
    }
  }

  private checkEvents(events: string[] | undefined): string[] {
    const list = [...new Set(events ?? [])];
    const bad = list.filter((e) => !(SUBSCRIBABLE_EVENTS as readonly string[]).includes(e));
    if (bad.length) throw new BusinessException('Unknown event', 'UNKNOWN_EVENT', HttpStatus.BAD_REQUEST, { allowed: SUBSCRIBABLE_EVENTS });
    return list;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------------------------------------------

  async create(userId: string, dto: { type: IntegrationType; name: string; targetUrl?: string; events?: string[]; credential?: string }, ctx?: IRequestContext) {
    if (!INTEGRATION_TYPES.includes(dto.type)) throw new BusinessException('Unknown integration type', 'UNKNOWN_INTEGRATION_TYPE', HttpStatus.BAD_REQUEST);
    const [{ n }] = await this.db.select({ n: sql<number>`count(*)::int` }).from(schema.integrations).where(eq(schema.integrations.userId, userId));
    if (Number(n) >= MAX_INTEGRATIONS_PER_USER) throw new BusinessException(`You can have at most ${MAX_INTEGRATIONS_PER_USER} integrations`, 'INTEGRATION_LIMIT', HttpStatus.CONFLICT);

    let targetUrl: string | null = null;
    let events: string[] = [];
    let credentialEnc: string | null = null;
    if (dto.type === 'WEBHOOK') {
      if (!dto.targetUrl) throw new BusinessException('A webhook needs a target URL', 'TARGET_URL_REQUIRED', HttpStatus.BAD_REQUEST);
      targetUrl = await this.checkUrl(dto.targetUrl);
      events = this.checkEvents(dto.events);
      if (!events.length) throw new BusinessException('Choose at least one event', 'EVENTS_REQUIRED', HttpStatus.BAD_REQUEST, { allowed: SUBSCRIBABLE_EVENTS });
    } else {
      if (!dto.credential) throw new BusinessException('A CRM connection needs an access token', 'CREDENTIAL_REQUIRED', HttpStatus.BAD_REQUEST);
      credentialEnc = sealSecret(dto.credential, process.env, 'integrations');
    }
    const signingSecret = newSigningSecret();
    const [row] = await this.db
      .insert(schema.integrations)
      .values({ userId, type: dto.type, name: dto.name.trim(), targetUrl, events, signingSecretEnc: sealSecret(signingSecret, process.env, 'integrations'), credentialEnc })
      .returning();
    await this.audit?.record({ userId, action: 'INTEGRATION_CREATED', entityType: 'INTEGRATION', entityId: row.id, newValues: { type: row.type, name: row.name, events, host: targetUrl ? new URL(targetUrl).host : null }, ipAddress: ctx?.ip, userAgent: ctx?.userAgent });
    // the signing secret is shown here and never again
    return { ...(await this.view(row)), signingSecret };
  }

  async list(userId: string) {
    const rows = await this.db.select().from(schema.integrations).where(eq(schema.integrations.userId, userId)).orderBy(desc(schema.integrations.createdAt));
    return Promise.all(rows.map((r) => this.view(r)));
  }

  async get(userId: string, id: string) {
    return this.view(await this.getOwned(userId, id));
  }

  async update(userId: string, id: string, dto: { name?: string; targetUrl?: string; events?: string[]; status?: 'ACTIVE' | 'PAUSED'; credential?: string }, ctx?: IRequestContext) {
    const cur = await this.getOwned(userId, id);
    const patch: Partial<typeof schema.integrations.$inferInsert> = { updatedAt: new Date() };
    if (dto.name !== undefined) patch.name = dto.name.trim();
    if (dto.targetUrl !== undefined) {
      if (cur.type !== 'WEBHOOK') throw new BusinessException('Only a webhook has a target URL', 'INVALID_UPDATE', HttpStatus.BAD_REQUEST);
      patch.targetUrl = await this.checkUrl(dto.targetUrl);
    }
    if (dto.events !== undefined) {
      if (cur.type !== 'WEBHOOK') throw new BusinessException('Only a webhook has events', 'INVALID_UPDATE', HttpStatus.BAD_REQUEST);
      const events = this.checkEvents(dto.events);
      if (!events.length) throw new BusinessException('Choose at least one event', 'EVENTS_REQUIRED', HttpStatus.BAD_REQUEST);
      patch.events = events;
    }
    if (dto.credential !== undefined) {
      if (cur.type === 'WEBHOOK') throw new BusinessException('A webhook has no access token', 'INVALID_UPDATE', HttpStatus.BAD_REQUEST);
      patch.credentialEnc = sealSecret(dto.credential, process.env, 'integrations');
    }
    // the owner turning it on again, or replacing a rejected credential, is a fresh start
    if (dto.status === 'ACTIVE' || (dto.credential !== undefined && cur.status === 'DISABLED')) {
      patch.status = 'ACTIVE';
      patch.consecutiveFailures = 0;
      patch.disabledReason = null;
    } else if (dto.status === 'PAUSED') patch.status = 'PAUSED';
    const [row] = await this.db.update(schema.integrations).set(patch).where(eq(schema.integrations.id, id)).returning();
    await this.audit?.record({ userId, action: 'INTEGRATION_UPDATED', entityType: 'INTEGRATION', entityId: id, oldValues: { name: cur.name, status: cur.status, events: cur.events }, newValues: { name: row.name, status: row.status, events: row.events, credentialReplaced: dto.credential !== undefined, urlChanged: dto.targetUrl !== undefined }, ipAddress: ctx?.ip, userAgent: ctx?.userAgent });
    return this.view(row);
  }

  async remove(userId: string, id: string, ctx?: IRequestContext) {
    const cur = await this.getOwned(userId, id);
    await this.db.delete(schema.integrations).where(eq(schema.integrations.id, id));
    await this.audit?.record({ userId, action: 'INTEGRATION_DELETED', entityType: 'INTEGRATION', entityId: id, oldValues: { type: cur.type, name: cur.name }, ipAddress: ctx?.ip, userAgent: ctx?.userAgent });
    return { success: true };
  }

  async rotateSecret(userId: string, id: string, ctx?: IRequestContext) {
    await this.getOwned(userId, id);
    const signingSecret = newSigningSecret();
    await this.db.update(schema.integrations).set({ signingSecretEnc: sealSecret(signingSecret, process.env, 'integrations'), updatedAt: new Date() }).where(eq(schema.integrations.id, id));
    await this.audit?.record({ userId, action: 'INTEGRATION_SECRET_ROTATED', entityType: 'INTEGRATION', entityId: id, ipAddress: ctx?.ip, userAgent: ctx?.userAgent });
    return { id, signingSecret };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Failure monitoring
  // ---------------------------------------------------------------------------------------------------------------

  /**
   * Called after every delivery attempt and every CRM sync run. A success clears the failure run; a failure extends it, and at
   * DISABLE_AFTER_CONSECUTIVE_FAILURES the integration is switched off, the owner is e-mailed and the event is audited.
   * `fatal` (a credential the other side rejected) switches it off at once.
   */
  async recordOutcome(integrationId: string, ok: boolean, error?: string, fatal?: string): Promise<void> {
    if (ok) {
      await this.db.update(schema.integrations).set({ consecutiveFailures: 0, lastSuccessAt: new Date() }).where(eq(schema.integrations.id, integrationId));
      return;
    }
    const [row] = await this.db
      .update(schema.integrations)
      .set({ consecutiveFailures: sql`${schema.integrations.consecutiveFailures} + 1`, lastFailureAt: new Date(), lastError: (error ?? 'failed').slice(0, 300) })
      .where(eq(schema.integrations.id, integrationId))
      .returning();
    if (!row || row.status === 'DISABLED') return;
    const reason = fatal ?? (row.consecutiveFailures >= DISABLE_AFTER_CONSECUTIVE_FAILURES ? `${row.consecutiveFailures} failures in a row` : null);
    if (!reason) return;
    await this.db.update(schema.integrations).set({ status: 'DISABLED', disabledReason: reason.slice(0, 100), updatedAt: new Date() }).where(eq(schema.integrations.id, integrationId));
    await this.audit?.record({ userId: row.userId, action: 'INTEGRATION_DISABLED', entityType: 'INTEGRATION', entityId: row.id, newValues: { type: row.type, reason, lastError: row.lastError } });
    const [user] = await this.db.select().from(schema.users).where(eq(schema.users.id, row.userId)).limit(1);
    if (user) {
      void this.mail?.send({
        to: user.email,
        subject: `Your integration "${row.name}" was switched off`,
        text: `Your ${row.type === 'WEBHOOK' ? 'webhook' : 'CRM'} integration "${row.name}" was switched off: ${reason}. Last error: ${row.lastError ?? 'unknown'}. Fix the problem, then turn it back on from your Integrations page.`,
      });
    }
    this.logger.warn(`Integration ${row.id} disabled: ${reason}`);
  }

  private async stats24h(integrationId: string) {
    const since = new Date(Date.now() - 86_400_000);
    const rows = rowsOf(
      await this.db.execute(sql`SELECT status, count(*)::int AS n FROM integration_deliveries WHERE integration_id = ${integrationId}::uuid AND created_at >= ${since.toISOString()} GROUP BY status`),
    );
    const n = (s: string) => rows.find((r) => r.status === s)?.n ?? 0;
    return { succeeded: n('SUCCEEDED'), retrying: n('FAILED'), pending: n('PENDING'), dead: n('DEAD') };
  }

  async healthOf(row: IntegrationRow) {
    const last24h = row.type === 'WEBHOOK' ? await this.stats24h(row.id) : null;
    let state: HealthState = 'HEALTHY';
    if (row.status === 'DISABLED') state = 'DISABLED';
    else if (row.status === 'PAUSED') state = 'PAUSED';
    else if (row.consecutiveFailures >= 5) state = 'FAILING';
    else if (row.consecutiveFailures >= 1 || (last24h && last24h.dead > 0)) state = 'DEGRADED';
    return { state, last24h };
  }

  /** Administrators: every integration that is not healthy, delivery backlog, and totals. */
  async adminHealth() {
    const rows = await this.db
      .select({ i: schema.integrations, email: schema.users.email })
      .from(schema.integrations)
      .leftJoin(schema.users, eq(schema.users.id, schema.integrations.userId))
      .orderBy(desc(schema.integrations.consecutiveFailures))
      .limit(500);
    const totals: Record<string, number> = { HEALTHY: 0, DEGRADED: 0, FAILING: 0, PAUSED: 0, DISABLED: 0 };
    const problems: any[] = [];
    for (const { i, email } of rows) {
      const state = (await this.healthOf(i)).state;
      totals[state]++;
      if (state === 'DEGRADED' || state === 'FAILING' || state === 'DISABLED') {
        problems.push({ id: i.id, userId: i.userId, userEmail: email, type: i.type, name: i.name, state, status: i.status, consecutiveFailures: i.consecutiveFailures, lastError: i.lastError, lastFailureAt: i.lastFailureAt, disabledReason: i.disabledReason });
      }
    }
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const overdueBefore = new Date(Date.now() - 10 * 60_000).toISOString();
    const [d] = rowsOf(await this.db.execute(sql`SELECT count(*) FILTER (WHERE status = 'DEAD')::int AS dead, count(*) FILTER (WHERE status IN ('PENDING','FAILED') AND next_attempt_at < ${overdueBefore})::int AS overdue, count(*) FILTER (WHERE status IN ('PENDING','FAILED'))::int AS queued FROM integration_deliveries WHERE created_at >= ${since}`));
    return { totals, problems, deliveries: { last7days: { dead: d?.dead ?? 0, queued: d?.queued ?? 0, overdue: d?.overdue ?? 0 } } };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Deliveries (owner's view)
  // ---------------------------------------------------------------------------------------------------------------

  async listDeliveries(userId: string, id: string, q: { status?: string; limit?: number; offset?: number }) {
    await this.getOwned(userId, id);
    const conds = [eq(schema.integrationDeliveries.integrationId, id)];
    if (q.status) conds.push(eq(schema.integrationDeliveries.status, q.status));
    const limit = Math.min(Math.max(Number(q.limit) || 25, 1), 100);
    const offset = Math.max(Number(q.offset) || 0, 0);
    const rows = await this.db.select().from(schema.integrationDeliveries).where(and(...conds)).orderBy(desc(schema.integrationDeliveries.createdAt)).limit(limit).offset(offset);
    const [{ n }] = await this.db.select({ n: sql<number>`count(*)::int` }).from(schema.integrationDeliveries).where(and(...conds));
    return {
      total: Number(n),
      limit,
      offset,
      items: rows.map((d) => ({ id: d.id, event: d.event, status: d.status, attempts: d.attempts, nextAttemptAt: d.status === 'SUCCEEDED' || d.status === 'DEAD' ? null : d.nextAttemptAt, lastStatusCode: d.lastStatusCode, lastError: d.lastError, durationMs: d.durationMs, ackStatus: d.ackStatus, ackMessage: d.ackMessage, createdAt: d.createdAt, deliveredAt: d.deliveredAt })),
    };
  }

  /** Puts a dead or failed delivery back in the queue. */
  async redeliver(userId: string, id: string, deliveryId: string, ctx?: IRequestContext) {
    const integ = await this.getOwned(userId, id);
    if (integ.status !== 'ACTIVE') throw new BusinessException('Turn the integration on before redelivering', 'INTEGRATION_NOT_ACTIVE', HttpStatus.CONFLICT);
    const rows = /^[0-9a-f-]{36}$/i.test(deliveryId)
      ? await this.db
          .update(schema.integrationDeliveries)
          .set({ status: 'PENDING', attempts: 0, nextAttemptAt: new Date(), lastError: null })
          .where(and(eq(schema.integrationDeliveries.id, deliveryId), eq(schema.integrationDeliveries.integrationId, id), inArray(schema.integrationDeliveries.status, ['DEAD', 'FAILED'])))
          .returning({ id: schema.integrationDeliveries.id })
      : [];
    if (!rows.length) throw new BusinessException('Only a failed or dead delivery of this integration can be redelivered', 'DELIVERY_NOT_REDELIVERABLE', HttpStatus.NOT_FOUND);
    await this.audit?.record({ userId, action: 'INTEGRATION_DELIVERY_REDELIVERED', entityType: 'INTEGRATION', entityId: id, newValues: { deliveryId }, ipAddress: ctx?.ip, userAgent: ctx?.userAgent });
    return { success: true };
  }

  async purgeOldDeliveries(): Promise<number> {
    const cutoff = new Date(Date.now() - DELIVERY_RETENTION_DAYS * 86_400_000);
    const rows = await this.db.delete(schema.integrationDeliveries).where(and(inArray(schema.integrationDeliveries.status, ['SUCCEEDED', 'DEAD']), lte(schema.integrationDeliveries.createdAt, cutoff))).returning({ id: schema.integrationDeliveries.id });
    return rows.length;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Sync validation for webhooks: did every event reach the receiver, and did the receiver say it processed it?
  // ---------------------------------------------------------------------------------------------------------------

  async validateDeliveries(userId: string, id: string, days = 7) {
    const integ = await this.getOwned(userId, id);
    const since = new Date(Date.now() - Math.min(Math.max(days, 1), DELIVERY_RETENTION_DAYS) * 86_400_000);
    const overdueBefore = new Date(Date.now() - 10 * 60_000);
    const [c] = rowsOf(
      await this.db.execute(sql`
        SELECT count(*)::int AS emitted,
          count(*) FILTER (WHERE status = 'SUCCEEDED')::int AS delivered,
          count(*) FILTER (WHERE status = 'DEAD')::int AS dead,
          count(*) FILTER (WHERE status IN ('PENDING','FAILED'))::int AS in_flight,
          count(*) FILTER (WHERE status IN ('PENDING','FAILED') AND next_attempt_at < ${overdueBefore.toISOString()})::int AS overdue,
          count(*) FILTER (WHERE ack_status = 'PROCESSED')::int AS processed,
          count(*) FILTER (WHERE ack_status = 'REJECTED')::int AS rejected,
          count(*) FILTER (WHERE status = 'SUCCEEDED' AND ack_status IS NULL)::int AS unacknowledged
        FROM integration_deliveries WHERE integration_id = ${id}::uuid AND created_at >= ${since.toISOString()} AND event <> 'integration.test'`),
    );
    const bad = await this.db
      .select({ id: schema.integrationDeliveries.id, event: schema.integrationDeliveries.event, status: schema.integrationDeliveries.status, ackStatus: schema.integrationDeliveries.ackStatus, lastError: schema.integrationDeliveries.lastError, createdAt: schema.integrationDeliveries.createdAt })
      .from(schema.integrationDeliveries)
      .where(and(eq(schema.integrationDeliveries.integrationId, id), gte(schema.integrationDeliveries.createdAt, since), sql`(${schema.integrationDeliveries.status} = 'DEAD' OR ${schema.integrationDeliveries.ackStatus} = 'REJECTED')`))
      .orderBy(desc(schema.integrationDeliveries.createdAt))
      .limit(20);
    const summary = { emitted: c?.emitted ?? 0, delivered: c?.delivered ?? 0, dead: c?.dead ?? 0, inFlight: c?.in_flight ?? 0, overdue: c?.overdue ?? 0, processedByReceiver: c?.processed ?? 0, rejectedByReceiver: c?.rejected ?? 0, deliveredButUnacknowledged: c?.unacknowledged ?? 0 };
    const report = { kind: 'DELIVERIES', integrationId: integ.id, windowDays: Math.round((Date.now() - since.getTime()) / 86_400_000), checkedAt: new Date().toISOString(), consistent: summary.dead === 0 && summary.overdue === 0 && summary.rejectedByReceiver === 0, summary, problems: bad };
    await this.db.update(schema.integrations).set({ lastValidation: report, lastValidatedAt: new Date() }).where(eq(schema.integrations.id, id));
    return report;
  }
}
