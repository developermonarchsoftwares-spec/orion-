import { HttpStatus, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { BusinessException } from '../../../common/errors/business.exception';
import { AuditLogService } from '../../../common/services/audit-log.service';
import { DRIZZLE_DATABASE } from '../../../database/database.constants';
import { DrizzleDb } from '../../../database/database.provider';
import * as schema from '../../../database/schema';
import { PublishQueueRepository } from '../repositories/duplicate-review.repositories';
import { ImportBatchRepository, ImportRecordRepository } from '../repositories/import.repositories';
import { BusinessService, ICreateBusinessAggregateInput } from '../../business/services/business.service';
import { QueueService } from '../../queue/queue.service';
import { QUEUE_NAMES } from '../../queue/queue.constants';
import { INormalizedRecordResult } from './normalization.service';
import { ValidationService } from './validation.service';
import { SourceTrustService } from './source-trust.service';
import { ImportPeopleBridge } from '../people/import-people.bridge';
import {
  IConflict,
  IMergeEntry,
  IProvenanceMetadata,
  buildOrigin,
  capImportLevel,
  emailLevel,
  freshness,
  identifierLevel,
  phoneLevel,
  planFactMerge,
  websiteLevel,
} from '../provenance/provenance.util';

/**
 * Who is publishing, and under which authority (Phase 15). A publish needs one of:
 *  - `ADMIN`: an administrator acting through the explicit publish route (actorId required); may knowingly override an unreviewed or
 *    restricted source, which is recorded;
 *  - `AUTO`: the import pipeline, only when the batch asked for automatic publication AND its source is approved; never overrides anything.
 * Any other caller (a queue worker, a script that calls the service directly) is refused: publication is never an anonymous side effect.
 */
export interface IPublishContext {
  via: 'ADMIN' | 'AUTO';
  actorId?: string | null;
  allowUnreviewedSource?: boolean;
  ip?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class PublishingService {
  private readonly logger = new Logger(PublishingService.name);

  constructor(
    private readonly publishRepo: PublishQueueRepository,
    private readonly recordRepo: ImportRecordRepository,
    private readonly batchRepo: ImportBatchRepository,
    private readonly businessService: BusinessService,
    private readonly queueService: QueueService,
    private readonly validation: ValidationService,
    private readonly sources: SourceTrustService,
    @Inject(DRIZZLE_DATABASE) private readonly db: DrizzleDb,
    @Optional() private readonly audit?: AuditLogService,
    /** Optional downstream stage: absent => the company import behaves exactly as before. */
    @Optional() private readonly peopleBridge?: ImportPeopleBridge,
  ) {}

  private async refuse(ctx: Partial<IPublishContext> | undefined, queueId: string, recordId: string | null, code: string, message: string, extra: Record<string, unknown> = {}): Promise<never> {
    await this.audit?.record({
      userId: ctx?.actorId ?? null,
      action: 'PUBLISH_REFUSED',
      entityType: 'PUBLISH_QUEUE',
      entityId: queueId,
      outcome: 'DENIED',
      failureCategory: code,
      ipAddress: ctx?.ip,
      userAgent: ctx?.userAgent,
      newValues: { recordId, via: ctx?.via ?? 'NONE', ...extra },
    });
    throw new BusinessException(message, code, HttpStatus.CONFLICT);
  }

  /**
   * Publishes an approved record into the 3NF business database and triggers search indexing.
   * Checks, in order: the caller's authority, the record state, the source's trust, and a fresh validation of the payload. A refusal leaves
   * the queue item PENDING (nothing is half done) and is audited.
   */
  async publishRecord(publishQueueId: string, ctx?: IPublishContext) {
    if (!ctx || (ctx.via === 'ADMIN' && !ctx.actorId) || (ctx.via !== 'ADMIN' && ctx.via !== 'AUTO')) {
      return this.refuse(ctx, publishQueueId, null, 'PUBLISH_NOT_AUTHORIZED', 'Publishing needs an administrator or an approved automatic import');
    }
    // Look the item up by id (the previous "first 10 pending" scan missed items beyond the tenth
    // and could never see a FAILED one). PENDING and FAILED items can be (re)published.
    const item = await this.publishRepo.findById(publishQueueId);

    if (!item || !item.record) {
      throw new Error(`Publish queue item '${publishQueueId}' is invalid or missing record`);
    }
    if (item.status !== 'PENDING' && item.status !== 'FAILED') {
      throw new Error(`Publish queue item '${publishQueueId}' is ${item.status} and cannot be published again`);
    }
    const record = item.record;
    if (record.status !== 'APPROVED' && record.status !== 'MERGED') {
      return this.refuse(ctx, item.id, record.id, 'RECORD_NOT_APPROVED', `The import record is ${record.status}, not approved for publication`);
    }

    // ---- source trust --------------------------------------------------------------------------------------------------
    const batch = await this.batchRepo.findById(record.batchId);
    if (!batch) return this.refuse(ctx, item.id, record.id, 'BATCH_NOT_FOUND', 'The import batch of this record no longer exists');
    const source = batch.sourceId ? (await this.db.select().from(schema.dataSources).where(eq(schema.dataSources.id, batch.sourceId)).limit(1))[0] ?? null : null;
    const wantsOverride = ctx.via === 'ADMIN' && ctx.allowUnreviewedSource === true;
    if (ctx.via === 'AUTO' && (batch.options as { autoPublish?: boolean } | null)?.autoPublish !== true) {
      return this.refuse(ctx, item.id, record.id, 'AUTO_PUBLISH_NOT_REQUESTED', 'This batch was not submitted for automatic publication');
    }
    const assessment = this.sources.assess(source, wantsOverride);
    if (!assessment.allowed) {
      return this.refuse(ctx, item.id, record.id, assessment.code, assessment.code === 'SOURCE_REVOKED' ? 'The source of this batch has been revoked' : assessment.code === 'SOURCE_INACTIVE' ? 'The source of this batch is switched off' : 'The source of this batch is not approved for publication', {
        sourceTrust: assessment.trust,
        batchId: batch.id,
      });
    }

    // ---- validation again, at the moment of publication (an edited payload, or rules changed since import) ---------------
    const payload = (record.normalizedPayload || record.rawPayload) as unknown as INormalizedRecordResult;
    const check = this.validation.validateRecord(payload);
    if (!check.isValid) {
      return this.refuse(ctx, item.id, record.id, 'VALIDATION_FAILED', 'The record no longer passes validation', { failedRules: check.logs.filter((l) => !l.passed && l.severity === 'ERROR').map((l) => l.ruleName).slice(0, 10) });
    }

    await this.publishRepo.updateStatus(item.id, 'PROCESSING');

    try {
      const now = new Date();
      const origin = buildOrigin({
        sourceId: source?.id ?? null,
        sourceName: source?.name ?? null,
        sourceTrust: assessment.trust,
        collectionMethod: source?.collectionMethod ?? null,
        batchId: batch.id,
        recordId: record.id,
        rowNumber: record.rowNumber ?? null,
        importedAt: (record.createdAt ?? now).toISOString(),
        publishedById: ctx.actorId ?? null,
        publishMode: (item.publishMode as 'CREATE' | 'MERGE' | 'UPDATE') ?? 'CREATE',
        overrideUsed: assessment.overrideUsed,
        now,
      });

      // Only values with a valid shape are published; a value that failed its format check stays in the import record (traceable) and is
      // listed here by field name only, so the business page never presents a malformed value as data.
      const dropped: Array<{ field: string; reason: string }> = [];
      const contacts = (payload.contacts ?? []).map((c, idx) => {
        const emailOk = c.email ? emailLevel(c.email) === 'FORMAT_VALID' : false;
        const phoneOk = c.phone ? phoneLevel(c.phone) === 'FORMAT_VALID' : false;
        if (c.email && !emailOk) dropped.push({ field: `contacts[${idx}].email`, reason: 'FORMAT_INVALID' });
        if (c.phone && !phoneOk) dropped.push({ field: `contacts[${idx}].phone`, reason: 'FORMAT_INVALID' });
        return {
          fullName: c.fullName,
          title: c.title,
          email: emailOk ? c.email : undefined,
          phone: phoneOk ? c.phone : undefined,
          isPrimary: c.isPrimary,
          metadata: {
            source: { sourceId: origin.sourceId, batchId: origin.batchId, recordId: origin.recordId },
            verification: { email: c.email ? (emailOk ? 'FORMAT_VALID' : 'UNVERIFIED') : null, phone: c.phone ? (phoneOk ? 'FORMAT_VALID' : 'UNVERIFIED') : null, checkedAt: now.toISOString(), highestPossible: 'FORMAT_VALID' },
          },
        };
      });
      const identifiers = (payload.identifiers ?? []).filter((i) => {
        const ok = ['GSTIN', 'PAN', 'CIN'].includes(i.type) ? identifierLevel(i.type, i.value) !== 'UNVERIFIED' : true;
        if (!ok) dropped.push({ field: `identifiers.${i.type}`, reason: 'FORMAT_INVALID' });
        return ok;
      });
      const verification = {
        identifiers: Object.fromEntries(identifiers.map((i) => [i.type, capImportLevel(identifierLevel(i.type, i.value))])),
        websites: Object.fromEntries((payload.digitalPresences ?? []).filter((d) => d.platform === 'WEBSITE').map((d) => [d.domain ?? d.url, websiteLevel(d.url)])),
        business: 'UNVERIFIED',
        checkedAt: now.toISOString(),
        freshness: freshness(now, now),
      };
      const provenance: IProvenanceMetadata = { schema: 1, origin, history: [] };
      const metadata = {
        provenance,
        verification,
        quality: { droppedValues: dropped, needsReview: dropped.length > 0, conflicts: [] as IConflict[] },
      };

      let businessId: string;
      let businessName: string;
      // the published business row (the same shape callers always received); a merge returns the id and name of the business it merged into
      let result: { id: string; name: string; [k: string]: unknown };
      if ((item.publishMode === 'MERGE' || item.publishMode === 'UPDATE') && item.targetBusinessId) {
        const merged = await this.mergeInto(item.targetBusinessId, payload, contacts, identifiers, origin, ctx);
        businessId = item.targetBusinessId;
        businessName = merged.name;
        result = { id: businessId, name: businessName, status: merged.status };
      } else {
        const aggregateInput: ICreateBusinessAggregateInput = {
          name: payload.name,
          legalName: payload.legalName,
          status: 'PUBLISHED',
          description: payload.description,
          foundingYear: payload.foundingYear,
          sourceId: source?.id,
          sourceBatchId: batch.id,
          createdById: ctx.actorId ?? undefined,
          metadata: metadata as unknown as Record<string, unknown>,
          locations: payload.locations?.map((loc) => ({
            addressLine1: loc.addressLine1,
            addressLine2: loc.addressLine2,
            city: loc.city,
            district: loc.district,
            state: loc.state,
            pincode: loc.pincode,
            country: loc.country,
          })),
          contacts,
          digitalPresences: payload.digitalPresences?.map((d) => ({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            platform: d.platform as any,
            url: d.url,
            domain: d.domain,
          })),
          identifiers: identifiers.map((i) => ({ type: i.type, value: i.value })),
        };
        // 1. Create 3NF Business Entity (one transaction: all of it or nothing)
        const created = await this.businessService.createBusinessAggregate(aggregateInput);
        businessId = created.id;
        businessName = created.name;
        result = created as unknown as typeof result;
      }

      // 2. Mark record & publish item as PUBLISHED
      await this.publishRepo.updateStatus(item.id, 'PUBLISHED', businessId);
      await this.recordRepo.updateStatus(record.id, 'PUBLISHED');

      // 3. Trigger Search Synchronization Queue
      await this.queueService.addJob(QUEUE_NAMES.TYPESENSE_SYNC, 'index-business', { businessId, action: 'UPSERT' });

      await this.audit?.record({
        userId: ctx.actorId ?? null,
        action: assessment.overrideUsed ? 'PUBLISH_OVERRIDE_USED' : 'IMPORT_RECORD_PUBLISHED',
        entityType: 'BUSINESS',
        entityId: businessId,
        outcome: 'SUCCESS',
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent,
        newValues: { via: ctx.via, mode: item.publishMode, batchId: batch.id, recordId: record.id, sourceId: source?.id ?? null, sourceTrust: assessment.trust, droppedValues: dropped.length },
      });

      this.logger.log(`Successfully published business: ${businessName} (ID: ${businessId}) via ${ctx.via} -> Search index enqueued`);

      // 4. People stage. The business is already committed and the record is PUBLISHED, so this
      // is a separate, best-effort step: the bridge never throws and its outcome is only reported.
      await this.peopleBridge?.ingestForPublishedRecord({ businessId, record });

      return result;
    } catch (error) {
      this.logger.error(`Publish failed for queue item ${publishQueueId}: ${(error as Error).message}`, (error as Error).stack);
      await this.publishRepo.updateStatus(item.id, 'FAILED', undefined, (error as Error).message);
      await this.audit?.record({ userId: ctx.actorId ?? null, action: 'PUBLISH_FAILED', entityType: 'PUBLISH_QUEUE', entityId: item.id, outcome: 'FAILURE', failureCategory: 'PUBLISH_ERROR', newValues: { recordId: record.id, batchId: batch.id } });
      throw error;
    }
  }

  /**
   * Adds what an import knows about an already published business WITHOUT changing what is published:
   * missing facts, contacts, identifiers, websites and addresses are added; a differing public fact or a different identifier of the same kind
   * is recorded as a conflict for review and the published value is kept. The business keeps its id (unlocks, credits, saved leads and history
   * are untouched) and gains a provenance history entry. All in one transaction.
   */
  private async mergeInto(
    targetId: string,
    payload: INormalizedRecordResult,
    contacts: Array<{ fullName: string; title?: string; email?: string; phone?: string; isPrimary?: boolean; metadata: Record<string, unknown> }>,
    identifiers: Array<{ type: string; value: string; normalizedValue: string }>,
    origin: ReturnType<typeof buildOrigin>,
    ctx: IPublishContext,
  ) {
    return this.db.transaction(async (tx) => {
      const [biz] = await tx.select().from(schema.businesses).where(eq(schema.businesses.id, targetId)).for('update');
      if (!biz) throw new BusinessException('The business to merge into no longer exists', 'MERGE_TARGET_MISSING', HttpStatus.CONFLICT);

      const fieldsAdded: string[] = [];
      const conflictFields: string[] = [];
      const now = new Date();

      // facts
      const facts = planFactMerge(biz as unknown as Record<string, unknown>, payload as unknown as Record<string, unknown>);
      if (Object.keys(facts.add).length) {
        await tx.update(schema.businesses).set({ ...(facts.add as object), updatedAt: now }).where(eq(schema.businesses.id, targetId));
        fieldsAdded.push(...Object.keys(facts.add));
      }
      conflictFields.push(...facts.conflicts);

      // contacts: add a contact only when neither its e-mail nor its phone is already on the business
      const existingContacts = await tx.select().from(schema.businessContacts).where(eq(schema.businessContacts.businessId, targetId));
      const key = (e?: string | null, p?: string | null) => ({ e: (e ?? '').trim().toLowerCase(), p: (p ?? '').replace(/\D/g, '').slice(-10) });
      const have = existingContacts.map((c) => key(c.email, c.phone));
      for (const c of contacts) {
        const k = key(c.email, c.phone);
        if (!k.e && !k.p) continue; // a name alone is not enough to say it is a different person
        const known = have.some((h) => (k.e && h.e === k.e) || (k.p && h.p === k.p));
        if (known) continue;
        await tx.insert(schema.businessContacts).values({ businessId: targetId, fullName: c.fullName, title: c.title, email: c.email, phone: c.phone, isPrimary: false, metadata: c.metadata });
        have.push(k);
        fieldsAdded.push('contact');
      }

      // identifiers: never replace; a different value of a kind the business already has is a conflict
      const existingIds = await tx.select().from(schema.businessIdentifiers).where(eq(schema.businessIdentifiers.businessId, targetId));
      for (const i of identifiers) {
        const same = existingIds.find((x) => x.type === i.type);
        if (!same) {
          const inserted = await tx.insert(schema.businessIdentifiers).values({ businessId: targetId, type: i.type as never, value: i.value.trim(), normalizedValue: i.normalizedValue, isPrimary: false }).onConflictDoNothing().returning({ id: schema.businessIdentifiers.id });
          if (inserted.length) fieldsAdded.push(`identifier:${i.type}`);
          else conflictFields.push(`identifier:${i.type}`); // the value belongs to another business
        } else if (same.normalizedValue !== i.normalizedValue) conflictFields.push(`identifier:${i.type}`);
      }

      // websites
      const existingWeb = await tx.select().from(schema.digitalPresences).where(eq(schema.digitalPresences.businessId, targetId));
      for (const d of payload.digitalPresences ?? []) {
        if (d.domain && existingWeb.some((w) => w.domain === d.domain && w.platform === (d.platform as never))) continue;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await tx.insert(schema.digitalPresences).values({ businessId: targetId, platform: d.platform as any, url: d.url, domain: d.domain });
        fieldsAdded.push(`website:${d.platform}`);
      }

      // locations: add only when the business has none; a different address is a conflict, not a replacement
      const existingLoc = await tx.select().from(schema.businessLocations).where(eq(schema.businessLocations.businessId, targetId));
      const inc = payload.locations?.[0];
      if (inc) {
        if (!existingLoc.length) {
          await tx.insert(schema.businessLocations).values({ businessId: targetId, addressLine1: inc.addressLine1, addressLine2: inc.addressLine2, city: inc.city, district: inc.district, state: inc.state, pincode: inc.pincode, country: inc.country || 'India', isPrimary: true });
          fieldsAdded.push('location');
        } else if (!existingLoc.some((l) => (l.pincode ?? '') === (inc.pincode ?? '') && (l.city ?? '').toLowerCase() === (inc.city ?? '').toLowerCase())) conflictFields.push('location');
      }

      // provenance and quality notes, appended (the origin of the first publication is never rewritten)
      const meta = (biz.metadata as Record<string, any>) || {};
      const history: IMergeEntry[] = [...((meta.provenance?.history as IMergeEntry[]) ?? [])];
      history.push({ at: now.toISOString(), mode: origin.publishMode === 'UPDATE' ? 'UPDATE' : 'MERGE', batchId: origin.batchId, recordId: origin.recordId, sourceId: origin.sourceId, sourceTrust: origin.sourceTrust, publishedById: ctx.actorId ?? null, fieldsAdded: [...new Set(fieldsAdded)], conflictFields });
      const conflicts: IConflict[] = [...((meta.quality?.conflicts as IConflict[]) ?? [])];
      for (const f of conflictFields) {
        const incoming = ['name', 'legalName', 'foundingYear'].includes(f) ? String((payload as unknown as Record<string, unknown>)[f] ?? '').slice(0, 200) : undefined;
        conflicts.push({ field: f, recordId: origin.recordId, batchId: origin.batchId, at: now.toISOString(), ...(incoming ? { incoming } : {}) });
      }
      const newMeta = {
        ...meta,
        provenance: { schema: 1, origin: meta.provenance?.origin ?? null, history: history.slice(-50) },
        quality: { ...(meta.quality ?? {}), conflicts: conflicts.slice(-100), needsReview: (meta.quality?.needsReview ?? false) || conflictFields.length > 0 },
      };
      await tx.update(schema.businesses).set({ metadata: newMeta, updatedAt: now }).where(eq(schema.businesses.id, targetId));
      await tx.insert(schema.businessHistory).values({
        businessId: targetId,
        changedById: ctx.actorId ?? null,
        changeType: 'IMPORT_MERGE',
        fullSnapshot: { fieldsAdded: [...new Set(fieldsAdded)], conflictFields }, // field names only: no contact values are copied
        changeReason: `Merged import record ${origin.recordId}`,
        sourceBatchId: origin.batchId,
      });
      return { name: biz.name, status: biz.status };
    });
  }
}
