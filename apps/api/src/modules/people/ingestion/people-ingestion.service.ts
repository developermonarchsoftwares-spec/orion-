import { HttpStatus, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { createHash } from 'crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { DRIZZLE_DATABASE } from '../../../database/database.constants';
import { DrizzleDb } from '../../../database/database.provider';
import * as schema from '../../../database/schema';
import { BusinessException } from '../../../common/errors/business.exception';
import { PeopleWriteService } from '../people-write.service';
import {
  IIngestionOptions,
  IIngestionReport,
  IPeopleIngestionService,
  ICompanyRef,
  IPeopleSource,
  IRawPersonRecord,
  IReason,
  IObservationStatus,
  IRecordResult,
} from './ingestion.types';
import { normalizeRawPerson } from './person-record.normalizer';
import {
  IMeasured,
  ObservationInputError,
  OBSERVATION_LIMITS,
  measureRecord,
  readObservationFields,
  safeQuarantineRaw,
} from '../observations/observation-policy';
import { ObservationService } from '../observations/observation.service';
import type { IObservationInput } from '../contracts/people-ingestion.contract';
import { findSuppressionMatch, identityOfUpsert } from '../suppression/people-suppression';
import { applySourcePolicy } from '../sources/source-policy';
import { SourceRegistryService } from '../sources/source-registry.service';
import type { ISourceDefinition } from '../sources/source.types';
import { CompanyResolverService } from '../../business/company-resolution/company-resolver.service';
import type { ICompanyCandidate, ICompanyResolution } from '../../business/company-resolution/company-resolution.types';

const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, val) =>
    val && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date)
      ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b)))
      : val,
  );

/**
 * Source-agnostic people ingestion (INTERNAL - deliberately has no controller):
 *
 *   raw record -> validate + normalise -> resolve existing company -> classify (role taxonomy)
 *   -> identity resolution / dedupe -> contacts -> evidence -> verification rules
 *   -> PeopleWriteService  (everything lands as DRAFT / invisible to customers)
 *
 * Bad records are quarantined (people_ingestion_quarantine), never silently inserted. Every
 * step is idempotent: re-running a batch creates no new people, roles, contacts or evidence.
 */
@Injectable()
export class PeopleIngestionService implements IPeopleIngestionService {
  private readonly logger = new Logger(PeopleIngestionService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: DrizzleDb,
    private readonly writer: PeopleWriteService,
    @Optional() private readonly registry?: SourceRegistryService,
    @Optional() private readonly observations?: ObservationService,
    @Optional() resolver?: CompanyResolverService,
  ) {
    // the resolver is stateless and read-only, so a default instance is safe for callers that construct the service by hand
    this.resolver = resolver ?? new CompanyResolverService(db);
  }

  private readonly resolver: CompanyResolverService;

  async ingestFromSource(source: IPeopleSource, options: IIngestionOptions = {}): Promise<IIngestionReport> {
    const records: IRawPersonRecord[] = [];
    for await (const r of source.records()) records.push(r);
    return this.ingest(records, { sourceLabel: source.name, ...(source.sourceKey ? { sourceKey: source.sourceKey } : {}), ...options });
  }

  async ingest(records: IRawPersonRecord[], options: IIngestionOptions = {}): Promise<IIngestionReport> {
    const batchRef = options.batchRef ?? `people-${new Date().toISOString()}`;
    const dryRun = !!options.dryRun;

    // Phase 6.1: a keyed source must be registered, enabled and have acknowledged terms, and its policy constrains every
    // record BEFORE normalisation. Unkeyed callers are unchanged. The whole run is refused if the source is not usable.
    let source: ISourceDefinition | undefined;
    if (options.sourceKey) {
      if (!this.registry) {
        throw new BusinessException('The source registry is not available', 'SOURCE_REGISTRY_UNAVAILABLE', HttpStatus.SERVICE_UNAVAILABLE);
      }
      source = await this.registry.assertUsable(options.sourceKey);
      if (records.length > OBSERVATION_LIMITS.MAX_RECORDS_PER_RUN) {
        throw new BusinessException(
          `A keyed run accepts at most ${OBSERVATION_LIMITS.MAX_RECORDS_PER_RUN} records (got ${records.length}); split the batch`,
          'BATCH_TOO_LARGE',
          HttpStatus.PAYLOAD_TOO_LARGE,
        );
      }
    }
    const acquiredAt = options.acquiredAt ?? new Date();
    const report: IIngestionReport = {
      batchRef,
      dryRun,
      total: records.length,
      created: 0,
      updated: 0,
      unchanged: 0,
      quarantined: 0,
      valid: 0,
      results: [],
    };
    if (source) {
      report.source = { key: source.key, version: source.version };
      report.observations = { recorded: 0, duplicate: 0, notRecorded: 0 };
    }

    for (let index = 0; index < records.length; index++) {
      const raw = records[index];
      const result = await this.processOne(raw, index, batchRef, options.sourceLabel ?? source?.displayName, dryRun, options.quarantine !== false, source, acquiredAt);
      report.results.push(result);
      if (report.observations && result.observation) {
        if (result.observation.status === 'RECORDED') report.observations.recorded++;
        else if (result.observation.status === 'DUPLICATE') report.observations.duplicate++;
        else report.observations.notRecorded++;
      }
      switch (result.outcome) {
        case 'CREATED': report.created++; break;
        case 'UPDATED': report.updated++; break;
        case 'UNCHANGED': report.unchanged++; break;
        case 'QUARANTINED': report.quarantined++; break;
        case 'VALID': report.valid++; break;
      }
    }
    return report;
  }

  private async processOne(
    raw: IRawPersonRecord,
    index: number,
    batchRef: string,
    sourceLabel: string | undefined,
    dryRun: boolean,
    persistQuarantine: boolean,
    source?: ISourceDefinition,
    acquiredAt: Date = new Date(),
  ): Promise<IRecordResult> {
    const skipQuarantineWrite = dryRun || !persistQuarantine;
    // Legacy / unkeyed callers are marked explicitly: no source record id is ever invented for them.
    let observation: IObservationStatus = { status: 'NOT_RECORDED', reason: source ? 'NO_SOURCE_RECORD_ID' : 'UNKEYED_SOURCE' };
    let obs: IObservationContext | undefined;
    try {
      let input = raw ?? {};
      let policyWarnings: IReason[] = [];
      if (source) {
        // 1. bounded, safe reading of the untrusted record (size, depth, plain values only)
        let measured: IMeasured;
        try {
          measured = measureRecord(input);
        } catch (e) {
          if (e instanceof ObservationInputError) {
            return { ...(await this.quarantine(raw, index, batchRef, sourceLabel, [{ code: e.code, message: e.message }], skipQuarantineWrite)), observation: { status: 'NOT_RECORDED', reason: 'MALFORMED_OR_OVERSIZED' } };
          }
          throw e;
        }
        // 2. provenance fields: record id, payload reference, observed date, no credentials
        const fields = readObservationFields(input);
        if (fields.violations.length) {
          return { ...(await this.quarantine(raw, index, batchRef, sourceLabel, fields.violations, skipQuarantineWrite)), observation: { status: 'NOT_RECORDED', reason: 'INVALID_PROVENANCE' } };
        }
        if (fields.sourceRecordId) {
          obs = {
            sourceKey: source.key,
            sourceVersion: source.version,
            sourceRecordId: fields.sourceRecordId,
            batchRef,
            acquiredAt,
            observedAt: fields.observedAt,
            contentFingerprint: measured.contentFingerprint,
            payloadBytes: measured.bytes,
            payloadRef: fields.payloadRef,
            name: typeof input.personName === 'string' ? input.personName : undefined,
            title: typeof input.jobTitle === 'string' ? input.jobTitle : undefined,
          };
        }
        // 3. source policy (Phase 6.1)
        const gated = applySourcePolicy(source.policy, source.sourceType, input);
        if (gated.violations.length) {
          return { ...(await this.quarantine(raw, index, batchRef, sourceLabel, gated.violations, skipQuarantineWrite, obs)), observation: obs ? { status: 'RECORDED' } : observation };
        }
        input = gated.record;
        policyWarnings = gated.warnings;
        // the fingerprint describes what is actually ingested (after policy)
        if (obs) obs.contentFingerprint = measureRecord(input).contentFingerprint;
        // 4. the same source record, same content, same run, already ingested: recognised, nothing written
        if (obs && !dryRun && this.observations && (await this.observations.isIngested(obs.sourceKey, obs.sourceRecordId, obs.contentFingerprint, batchRef))) {
          return { index, outcome: 'UNCHANGED', observation: { status: 'DUPLICATE' }, warnings: [{ code: 'OBSERVATION_DUPLICATE', message: 'This source record was already ingested in this run' }] };
        }
        if (obs && dryRun) observation = { status: 'NOT_RECORDED', reason: 'DRY_RUN' };
      }
      const normalized = normalizeRawPerson(input);
      if (!normalized.ok) return { ...(await this.quarantine(raw, index, batchRef, sourceLabel, normalized.reasons, skipQuarantineWrite, obs)), observation: obs ? { status: 'RECORDED' } : observation };

      const { record } = normalized;
      record.warnings.unshift(...policyWarnings);
      // Suppression registry (Phase 6.4): deterministic identity signals only. Also enforced again, atomically, inside the write.
      const suppressed = await findSuppressionMatch(this.db, identityOfUpsert(record.upsert));
      if (suppressed) {
        throw new BusinessException('This person has been suppressed and cannot be re-ingested', 'SUPPRESSED_PERSON', HttpStatus.CONFLICT, {
          suppression: { kind: suppressed.kind, personId: suppressed.personId },
        });
      }
      const businessId = await this.resolveBusiness(record.businessRef);
      if (dryRun) return { index, outcome: 'VALID', warnings: record.warnings, observation };

      const res = await this.writer.upsertPersonForBusiness({
        ...record.upsert,
        businessId,
        // Ingestion NEVER publishes: dataStatus is left undefined (DRAFT for new people/roles).
        // The observation is written by the writer INSIDE the same transaction as the person / role / evidence.
        ...(obs ? { observation: toObservationInput(obs) } : {}),
      });
      if (res.observation) observation = res.observation.recorded ? { status: 'RECORDED' } : { status: 'DUPLICATE' };

      await this.markResolved(raw);
      const warnings: IReason[] = [
        ...record.warnings,
        ...res.warnings.map((w) => ({ code: w.split(':')[0], message: w })),
      ];
      return {
        index,
        outcome: res.personCreated ? 'CREATED' : res.unchanged ? 'UNCHANGED' : 'UPDATED',
        personId: res.personId,
        companyPersonId: res.companyPersonId,
        warnings,
        observation,
      };
    } catch (err) {
      const reasons: IReason[] =
        err instanceof BusinessException
          ? [{ code: err.errorCode, message: err.message, ...(isPlainObject(err.details) ? { details: err.details } : {}) }]
          : [{ code: 'PROCESSING_ERROR', message: (err as Error)?.message ?? 'Unexpected error' }];
      if (!(err instanceof BusinessException)) this.logger.error(`Ingestion record ${index} failed: ${(err as Error)?.stack}`);
      // The person write (and its observation) rolled back as one; the failure itself stays traceable as a QUARANTINED observation.
      const q = await this.quarantine(raw, index, batchRef, sourceLabel, reasons, skipQuarantineWrite, obs);
      return { ...q, observation: obs ? { status: 'RECORDED' } : observation };
    }
  }

  /** Read-only company match report for reviewers (quarantine detail). Never creates anything. */
  async checkCompany(ref: ICompanyRef): Promise<{
    status: 'MATCHED' | 'NOT_FOUND' | 'AMBIGUOUS';
    businessId?: string;
    businessName?: string;
    matchedBy?: string;
    candidates?: Array<{ companyId: string; companyName?: string; matchedBy: string; reasonCodes: string[] }>;
    reasonCodes?: string[];
  }> {
    const res = await this.resolver.resolve(toCandidate(ref));
    if (res.status === 'MATCHED') {
      const b = await this.db.query.businesses.findFirst({ where: eq(schema.businesses.id, res.companyId!), columns: { name: true } });
      return { status: 'MATCHED', businessId: res.companyId, businessName: b?.name, matchedBy: res.matchedBy, reasonCodes: res.reasonCodes };
    }
    if (res.status === 'AMBIGUOUS') {
      const names = await this.namesOf((res.candidates ?? []).map((c) => c.companyId));
      return {
        status: 'AMBIGUOUS',
        candidates: (res.candidates ?? []).map((c) => ({ companyId: c.companyId, companyName: names.get(c.companyId), matchedBy: c.matchedBy, reasonCodes: c.reasonCodes })),
        reasonCodes: res.reasonCodes,
      };
    }
    return { status: 'NOT_FOUND', reasonCodes: res.reasonCodes };
  }

  /**
   * Phase 6.3: company identification goes through the shared, read-only CompanyResolver. MATCHED continues; AMBIGUOUS and
   * NOT_FOUND raise a BusinessException that quarantines the record. People ingestion never creates a company and never
   * attaches a person to a company it could not identify with certainty.
   */
  private async resolveBusiness(ref: ICompanyRef): Promise<string> {
    const res: ICompanyResolution = await this.resolver.resolve(toCandidate(ref));
    if (res.status === 'MATCHED') return res.companyId!;
    if (res.status === 'AMBIGUOUS') {
      throw new BusinessException(
        'The company could not be identified with certainty: several companies match; a reviewer must choose',
        'AMBIGUOUS_COMPANY_MATCH',
        HttpStatus.CONFLICT,
        {
          // ids and machine codes only: enough for a reviewer, nothing from the source payload
          companyMatch: { status: res.status, candidates: res.candidates, reasonCodes: res.reasonCodes },
        },
      );
    }
    throw new BusinessException('Company not found: the record does not match an existing business', 'BUSINESS_NOT_FOUND', HttpStatus.NOT_FOUND, {
      companyMatch: { status: res.status, reasonCodes: res.reasonCodes },
    });
  }

  private async namesOf(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db.select({ id: schema.businesses.id, name: schema.businesses.name }).from(schema.businesses).where(inArray(schema.businesses.id, ids));
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  private async quarantine(
    raw: IRawPersonRecord,
    index: number,
    batchRef: string,
    sourceLabel: string | undefined,
    reasons: IReason[],
    dryRun: boolean,
    obs?: IObservationContext,
  ): Promise<IRecordResult> {
    if (!dryRun) {
      // Oversized, unserialisable or cyclic records are stored as a stub, and can never crash a run.
      const safe = safeQuarantineRaw(raw ?? {});
      let fingerprint: string;
      try {
        fingerprint = createHash('sha256').update(stable(raw ?? {})).digest('hex');
      } catch {
        fingerprint = createHash('sha256').update(`unserialisable:${batchRef}:${index}`).digest('hex');
      }
      await this.db
        .insert(schema.peopleIngestionQuarantine)
        .values({
          batchRef,
          sourceLabel: (sourceLabel ?? raw?.source?.label ?? null)?.slice(0, 100) ?? null,
          fingerprint,
          raw: safe.raw,
          reasons,
        })
        .onConflictDoUpdate({
          target: schema.peopleIngestionQuarantine.fingerprint,
          set: { reasons, batchRef, status: 'PENDING', updatedAt: new Date() },
        });
    }
    // A quarantined keyed record stays traceable: the refusal is an observation too (codes only, no personal data).
    if (obs && !dryRun && this.observations) {
      try {
        await this.observations.recordQuarantined({
          sourceKey: obs.sourceKey,
          sourceVersion: obs.sourceVersion,
          sourceRecordId: obs.sourceRecordId,
          batchRef: obs.batchRef,
          acquiredAt: obs.acquiredAt,
          observedAt: obs.observedAt,
          contentFingerprint: obs.contentFingerprint,
          payloadBytes: obs.payloadBytes,
          payloadRef: obs.payloadRef,
          reasonCodes: reasons.map((r) => r.code),
          observedName: obs.name,
          observedTitle: obs.title,
        });
      } catch (err) {
        this.logger.warn(`Could not record the quarantined observation: ${(err as Error)?.message}`); // never masks the quarantine itself
      }
    }
    return { index, outcome: 'QUARANTINED', reasons };
  }

  /** A previously quarantined record that now ingests cleanly is closed out. */
  private async markResolved(raw: IRawPersonRecord): Promise<void> {
    let fingerprint: string;
    try {
      fingerprint = createHash('sha256').update(stable(raw ?? {})).digest('hex');
    } catch {
      return;
    }
    await this.db
      .update(schema.peopleIngestionQuarantine)
      .set({ status: 'RESOLVED', updatedAt: new Date() })
      .where(and(eq(schema.peopleIngestionQuarantine.fingerprint, fingerprint), sql`${schema.peopleIngestionQuarantine.status} = 'PENDING'`));
  }
}

/** Everything known about one observed source record while it moves through ingestion. */
interface IObservationContext {
  sourceKey: string;
  sourceVersion: string;
  sourceRecordId: string;
  batchRef: string;
  acquiredAt: Date;
  observedAt: Date | null;
  contentFingerprint: string;
  payloadBytes: number;
  payloadRef?: string;
  name?: string;
  title?: string;
}

const toObservationInput = (o: IObservationContext): IObservationInput => ({
  sourceKey: o.sourceKey,
  sourceVersion: o.sourceVersion,
  sourceRecordId: o.sourceRecordId,
  batchRef: o.batchRef,
  acquiredAt: o.acquiredAt,
  observedAt: o.observedAt,
  contentFingerprint: o.contentFingerprint,
  payloadBytes: o.payloadBytes,
  payloadRef: o.payloadRef,
});

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Normalised company reference -> resolver input. */
function toCandidate(ref: ICompanyRef): ICompanyCandidate {
  const identifiers = [...(ref.identifier ? [ref.identifier] : []), ...(ref.identifiers ?? [])];
  return {
    id: ref.id,
    slug: ref.slug,
    identifiers: identifiers.length ? identifiers : undefined,
    website: ref.website,
    domain: ref.domain,
    name: ref.name,
    legalName: ref.legalName,
    city: ref.city,
    state: ref.state,
    pincode: ref.pincode,
  };
}
