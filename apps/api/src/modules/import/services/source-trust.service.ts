import { HttpStatus, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import { BusinessException } from '../../../common/errors/business.exception';
import { AuditLogService } from '../../../common/services/audit-log.service';
import { DRIZZLE_DATABASE } from '../../../database/database.constants';
import { DrizzleDb } from '../../../database/database.provider';
import * as schema from '../../../database/schema';
import { QueueService } from '../../queue/queue.service';
import { QUEUE_NAMES } from '../../queue/queue.constants';
import { SourceTrustStatus } from '../provenance/provenance.util';

export interface ISourceActor {
  id: string;
  ip?: string | null;
  userAgent?: string | null;
}

export type PublishAssessment =
  | { allowed: true; trust: SourceTrustStatus | 'NONE'; overrideUsed: boolean; code: 'APPROVED' | 'OVERRIDE' }
  | { allowed: false; trust: SourceTrustStatus | 'NONE'; overrideUsed: false; code: 'SOURCE_REVOKED' | 'SOURCE_INACTIVE' | 'SOURCE_NOT_APPROVED' };

/**
 * The source registry and the rules that decide whether records from a source may be published (Phase 15).
 *
 * Trust model:
 *   APPROVED    an administrator assessed the source and its terms; records may be published
 *   UNREVIEWED  the default and the honest state of any source nobody assessed; records are not published unless an administrator knowingly overrides
 *   RESTRICTED  usable only within the recorded restrictions; never published automatically, only by a recorded override
 *   REVOKED     nothing is published; what the source already supplied is held back (reversibly)
 *   (none)      the batch named no source: unknown provenance, treated like UNREVIEWED
 * Public availability of data is not recorded as permission: only an administrator's decision is.
 */
@Injectable()
export class SourceTrustService {
  private readonly logger = new Logger(SourceTrustService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: DrizzleDb,
    @Optional() private readonly audit?: AuditLogService,
    @Optional() private readonly queue?: QueueService,
  ) {}

  private ctx(actor: ISourceActor) {
    return { userId: actor.id, ipAddress: actor.ip ?? null, userAgent: actor.userAgent ?? null };
  }

  async list() {
    const rows = await this.db.select().from(schema.dataSources).orderBy(desc(schema.dataSources.updatedAt)).limit(500);
    return rows.map((r) => this.view(r));
  }

  async get(id: string) {
    const [row] = await this.db.select().from(schema.dataSources).where(eq(schema.dataSources.id, id)).limit(1);
    if (!row) throw new BusinessException('Source not found', 'SOURCE_NOT_FOUND', HttpStatus.NOT_FOUND);
    return row;
  }

  /** Administrator view. Internal: restrictions and decisions are never part of a customer response. */
  view(r: typeof schema.dataSources.$inferSelect) {
    return {
      id: r.id,
      name: r.name,
      type: r.type,
      description: r.description,
      trustStatus: r.trustStatus as SourceTrustStatus,
      usageRestrictions: r.usageRestrictions,
      collectionMethod: r.collectionMethod,
      sourceReference: r.sourceReference,
      isActive: r.isActive,
      trustDecidedAt: r.trustDecidedAt,
      trustDecidedById: r.trustDecidedById,
      trustReason: r.trustReason,
      createdAt: r.createdAt,
    };
  }

  async register(
    input: { name: string; type: (typeof schema.dataSources.$inferInsert)['type']; description?: string; collectionMethod?: string; sourceReference?: string; usageRestrictions?: string },
    actor: ISourceActor,
  ) {
    const [row] = await this.db
      .insert(schema.dataSources)
      .values({
        name: input.name.trim(),
        type: input.type,
        description: input.description?.trim() || null,
        collectionMethod: input.collectionMethod?.trim() || null,
        sourceReference: input.sourceReference?.trim() || null,
        usageRestrictions: input.usageRestrictions?.trim() || null,
        trustStatus: 'UNREVIEWED', // a new source is never trusted by being registered
      })
      .returning();
    await this.audit?.record({
      ...this.ctx(actor),
      action: 'SOURCE_REGISTERED',
      entityType: 'DATA_SOURCE',
      entityId: row.id,
      outcome: 'SUCCESS',
      newValues: { name: row.name, type: row.type, trustStatus: row.trustStatus, collectionMethod: row.collectionMethod },
    });
    return this.view(row);
  }

  /** Approve, restrict, revoke or reset a source. Needs a reason; restricting needs the restriction text. Every change is audited. */
  async setTrust(id: string, status: SourceTrustStatus, reason: string, usageRestrictions: string | undefined, actor: ISourceActor) {
    const current = await this.get(id);
    if (status === 'RESTRICTED' && !(usageRestrictions ?? current.usageRestrictions)?.trim()) {
      throw new BusinessException('Describe the restriction before restricting a source', 'RESTRICTION_TEXT_REQUIRED', HttpStatus.BAD_REQUEST);
    }
    const now = new Date();
    const [row] = await this.db
      .update(schema.dataSources)
      .set({
        trustStatus: status,
        usageRestrictions: usageRestrictions !== undefined ? usageRestrictions.trim() || null : current.usageRestrictions,
        trustDecidedById: actor.id,
        trustDecidedAt: now,
        trustReason: reason.trim().slice(0, 500),
        updatedAt: now,
      })
      .where(eq(schema.dataSources.id, id))
      .returning();

    let held = 0;
    if (status === 'REVOKED' && current.trustStatus !== 'REVOKED') held = await this.holdPublished(id, reason, now);

    const action = { APPROVED: 'SOURCE_APPROVED', RESTRICTED: 'SOURCE_RESTRICTED', REVOKED: 'SOURCE_REVOKED', UNREVIEWED: 'SOURCE_TRUST_RESET' }[status];
    await this.audit?.record({
      ...this.ctx(actor),
      action,
      entityType: 'DATA_SOURCE',
      entityId: id,
      outcome: 'SUCCESS',
      oldValues: { trustStatus: current.trustStatus },
      newValues: { trustStatus: status, reason: reason.trim().slice(0, 300), businessesHeldBack: held, restrictionsChanged: usageRestrictions !== undefined },
    });
    return { ...this.view(row), businessesHeldBack: held };
  }

  /**
   * Reversible hold: businesses this source published stop being customer-visible (status PENDING_VALIDATION), with the reason and previous
   * status written into their internal metadata, and their search entries are removed. Nothing is deleted. Businesses with no recorded source
   * (published before provenance was recorded) cannot be attributed and are not touched.
   */
  private async holdPublished(sourceId: string, reason: string, at: Date): Promise<number> {
    const hold = JSON.stringify({ sourceId, at: at.toISOString(), previousStatus: 'PUBLISHED', reason: 'SOURCE_REVOKED' });
    const rows = await this.db
      .update(schema.businesses)
      .set({ status: 'PENDING_VALIDATION', metadata: sql`coalesce(${schema.businesses.metadata}, '{}'::jsonb) || jsonb_build_object('heldBySource', ${hold}::jsonb)`, updatedAt: at })
      .where(and(eq(schema.businesses.sourceId, sourceId), eq(schema.businesses.status, 'PUBLISHED')))
      .returning({ id: schema.businesses.id });
    for (const r of rows.slice(0, 5000)) {
      await this.queue?.addJob(QUEUE_NAMES.TYPESENSE_SYNC, 'index-business', { businessId: r.id, action: 'DELETE' }).catch(() => undefined);
    }
    if (rows.length) this.logger.warn(`Source ${sourceId} revoked: ${rows.length} published business(es) held back`);
    return rows.length;
  }

  /** Puts back what a revocation held, once the source is approved or restricted again. */
  async releaseHeld(id: string, reason: string, actor: ISourceActor) {
    const src = await this.get(id);
    if (src.trustStatus === 'REVOKED' || src.trustStatus === 'UNREVIEWED') {
      throw new BusinessException('Approve or restrict the source before releasing what was held back', 'SOURCE_NOT_APPROVED', HttpStatus.CONFLICT);
    }
    const rows = await this.db
      .update(schema.businesses)
      .set({ status: 'PUBLISHED', metadata: sql`coalesce(${schema.businesses.metadata}, '{}'::jsonb) - 'heldBySource'`, updatedAt: new Date() })
      .where(and(eq(schema.businesses.sourceId, id), eq(schema.businesses.status, 'PENDING_VALIDATION'), sql`${schema.businesses.metadata}->'heldBySource'->>'sourceId' = ${id}`))
      .returning({ id: schema.businesses.id });
    for (const r of rows.slice(0, 5000)) {
      await this.queue?.addJob(QUEUE_NAMES.TYPESENSE_SYNC, 'index-business', { businessId: r.id, action: 'UPSERT' }).catch(() => undefined);
    }
    await this.audit?.record({ ...this.ctx(actor), action: 'SOURCE_HELD_RELEASED', entityType: 'DATA_SOURCE', entityId: id, outcome: 'SUCCESS', newValues: { released: rows.length, reason: reason.trim().slice(0, 300) } });
    return { released: rows.length };
  }

  async impact(id: string) {
    await this.get(id);
    const byStatus = await this.db.select({ status: schema.businesses.status, n: count() }).from(schema.businesses).where(eq(schema.businesses.sourceId, id)).groupBy(schema.businesses.status);
    const [batches] = await this.db.select({ n: count() }).from(schema.importBatches).where(eq(schema.importBatches.sourceId, id));
    return { businessesByStatus: Object.fromEntries(byStatus.map((r) => [r.status, Number(r.n)])), batches: Number(batches?.n ?? 0) };
  }

  /**
   * May records of this batch's source be published, and under what condition?
   * `override` is the explicit, recorded choice of an administrator; automatic publication never passes it.
   */
  assess(source: typeof schema.dataSources.$inferSelect | null, override: boolean): PublishAssessment {
    if (!source) return override ? { allowed: true, trust: 'NONE', overrideUsed: true, code: 'OVERRIDE' } : { allowed: false, trust: 'NONE', overrideUsed: false, code: 'SOURCE_NOT_APPROVED' };
    const trust = source.trustStatus as SourceTrustStatus;
    if (trust === 'REVOKED') return { allowed: false, trust, overrideUsed: false, code: 'SOURCE_REVOKED' };
    if (!source.isActive) return { allowed: false, trust, overrideUsed: false, code: 'SOURCE_INACTIVE' };
    if (trust === 'APPROVED') return { allowed: true, trust, overrideUsed: false, code: 'APPROVED' };
    return override ? { allowed: true, trust, overrideUsed: true, code: 'OVERRIDE' } : { allowed: false, trust, overrideUsed: false, code: 'SOURCE_NOT_APPROVED' };
  }
}
