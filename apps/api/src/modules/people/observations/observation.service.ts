import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq } from 'drizzle-orm';
import { DRIZZLE_DATABASE } from '../../../database/database.constants';
import { DrizzleDb } from '../../../database/database.provider';
import * as schema from '../../../database/schema';

export interface IQuarantinedObservation {
  sourceKey: string;
  sourceVersion: string;
  sourceRecordId: string;
  batchRef: string;
  acquiredAt: Date;
  observedAt: Date | null;
  contentFingerprint: string;
  payloadBytes: number;
  payloadRef?: string;
  /** Machine codes only. */
  reasonCodes: string[];
  observedName?: string;
  observedTitle?: string;
}

/**
 * Observation log access for the ingestion layer. INGESTED observations are written by PeopleWriteService inside the
 * person write's own transaction; this service covers the rest: recognising a source record that was already ingested in
 * this run, recording quarantined observations, and reading history. Rows are append-only (DB trigger); nothing here updates.
 * Internal only: no controller exposes observations and no customer contract includes them.
 */
@Injectable()
export class ObservationService {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: DrizzleDb) {}

  /** True when this exact observation (same source record, same content, same run) was already ingested. */
  async isIngested(sourceKey: string, sourceRecordId: string, contentFingerprint: string, batchRef: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: schema.peopleObservations.id })
      .from(schema.peopleObservations)
      .where(
        and(
          eq(schema.peopleObservations.sourceKey, sourceKey),
          eq(schema.peopleObservations.sourceRecordId, sourceRecordId),
          eq(schema.peopleObservations.contentFingerprint, contentFingerprint),
          eq(schema.peopleObservations.batchRef, batchRef),
          eq(schema.peopleObservations.outcome, 'INGESTED'),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  /** Records a record the People layer refused. A repeat of the identical refusal in the same run adds nothing. */
  async recordQuarantined(o: IQuarantinedObservation): Promise<boolean> {
    const rows = await this.db
      .insert(schema.peopleObservations)
      .values({
        sourceKey: o.sourceKey,
        sourceVersion: o.sourceVersion,
        sourceRecordId: o.sourceRecordId,
        batchRef: o.batchRef,
        acquiredAt: o.acquiredAt,
        observedAt: o.observedAt,
        contentFingerprint: o.contentFingerprint,
        outcome: 'QUARANTINED',
        reasonCodes: [...new Set(o.reasonCodes)].slice(0, 20),
        observedName: o.observedName?.slice(0, 200) ?? null,
        observedTitle: o.observedTitle?.slice(0, 200) ?? null,
        payloadBytes: o.payloadBytes,
        payloadRef: o.payloadRef ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: schema.peopleObservations.id });
    return rows.length > 0;
  }

  /** Full history of one source record, oldest acquisition first. */
  async history(sourceKey: string, sourceRecordId: string) {
    return this.db
      .select()
      .from(schema.peopleObservations)
      .where(and(eq(schema.peopleObservations.sourceKey, sourceKey), eq(schema.peopleObservations.sourceRecordId, sourceRecordId)))
      .orderBy(asc(schema.peopleObservations.acquiredAt), asc(schema.peopleObservations.createdAt));
  }

  /**
   * Internal: every source claim behind one canonical contact (or, with `claimType: 'LINKEDIN'`, behind a person's LinkedIn
   * digest), newest first. Joins observation -> source key / version / record / run and the backing evidence. Returns digests
   * and ids only. No controller exposes this and no customer contract includes it.
   */
  async contactProvenance(contactId: string) {
    const c = schema.peopleObservationClaims;
    const o = schema.peopleObservations;
    return this.db
      .select({
        claimType: c.claimType,
        valueDigest: c.valueDigest,
        contactId: c.contactId,
        observationId: o.id,
        sourceKey: o.sourceKey,
        sourceVersion: o.sourceVersion,
        sourceRecordId: o.sourceRecordId,
        batchRef: o.batchRef,
        acquiredAt: o.acquiredAt,
        observedAt: o.observedAt,
        evidenceId: c.evidenceId,
      })
      .from(c)
      .innerJoin(o, eq(o.id, c.observationId))
      .where(eq(c.contactId, contactId))
      .orderBy(desc(o.acquiredAt), desc(c.createdAt));
  }

  async linkedinProvenance(personId: string) {
    const c = schema.peopleObservationClaims;
    const o = schema.peopleObservations;
    return this.db
      .select({ valueDigest: c.valueDigest, observationId: o.id, sourceKey: o.sourceKey, sourceVersion: o.sourceVersion, sourceRecordId: o.sourceRecordId, evidenceId: c.evidenceId, acquiredAt: o.acquiredAt })
      .from(c)
      .innerJoin(o, eq(o.id, c.observationId))
      .where(and(eq(c.claimType, 'LINKEDIN'), eq(o.personId, personId)))
      .orderBy(desc(o.acquiredAt), desc(c.createdAt));
  }
}
