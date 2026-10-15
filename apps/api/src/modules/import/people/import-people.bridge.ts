import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { createHash } from 'crypto';
import type {
  IIngestionReport,
  IPeopleIngestionService,
  IRawPersonRecord,
} from '../../people/ingestion/ingestion.types';
import { PEOPLE_INGESTION_SERVICE } from '../../people/ingestion/ingestion.types';
import { ImportBatchRepository, ImportRecordRepository } from '../repositories/import.repositories';
import { emptyPeopleResult, IImportPeopleResult } from './import-people.types';

/**
 * Registry key of this source in people_sources (seeded by migration 0009). Kept as a literal here so the import module
 * does not import People code; a test asserts it equals BUILT_IN_SOURCE_KEYS.COMPANY_UPLOAD.
 */
export const UPLOAD_SOURCE_KEY = 'company-upload';

/** Stable source-record id of one person extracted from one import record (at most 200 characters). */
export function uploadRecordId(batchId: string, reference: string | undefined): string {
  const id = `${batchId}|${reference ?? ''}`;
  return id.length <= 200 ? id : `${batchId}|sha:${createHash('sha256').update(reference ?? '').digest('hex')}`;
}

/** Most people read from one company row (person 1 + person_2_* ... person_5_*). */
export const MAX_PEOPLE_PER_ROW = 5;

/** Ingestion reason codes that mean "held for review", as opposed to "the person data is invalid". */
const HELD_CODES = new Set([
  'AMBIGUOUS_IDENTITY',
  'PERSON_SUPPRESSED',
  'SUPPRESSED_PERSON',
  'BUSINESS_NOT_FOUND',
  'AMBIGUOUS_BUSINESS',
  'AMBIGUOUS_COMPANY_MATCH',
  'PROCESSING_ERROR',
]);

const text = (v: unknown): string | undefined => {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s === '' ? undefined : s;
};
const firstOf = (row: Record<string, unknown>, keys: string[]) => {
  for (const k of keys) {
    const v = text(row[k]);
    if (v) return v;
  }
  return undefined;
};

export interface IUploadProvenance {
  /** data_source_type of the batch's source when one is linked; otherwise a manual upload. */
  sourceType?: string;
  batchId: string;
  filename: string;
  rowNumber: number;
  /** When the row was received (import_records.created_at). */
  observedAt: Date;
}

/**
 * Reads people from the RAW uploaded row (never from the normalised record: the normaliser
 * fabricates a "Primary Contact / Director/Owner" placeholder that must not become a person).
 *
 * Recognised columns (all optional):
 *   person 1: contact_person | director_name  (+ contact_title | title | designation),
 *             person_email, person_phone, person_mobile, person_linkedin
 *   person n: person_<n>_name, person_<n>_title, person_<n>_email, person_<n>_phone,
 *             person_<n>_mobile, person_<n>_linkedin      (n = 2..5)
 *
 * The row-level `email`/`phone` are COMPANY contact details and are deliberately not attached to
 * a person: attributing them would be a guess. Nothing is inferred or defaulted.
 */
export function extractPeopleFromRow(
  raw: Record<string, unknown>,
  businessId: string,
  provenance: IUploadProvenance,
): IRawPersonRecord[] {
  const source = {
    type: provenance.sourceType ?? 'MANUAL_IMPORT',
    label: `import-batch:${provenance.batchId}`,
    reference: `${provenance.filename}#row:${provenance.rowNumber}`.slice(0, 255),
    evidenceType: 'UPLOAD_ROW',
    observedAt: provenance.observedAt,
  };

  const people: IRawPersonRecord[] = [];
  for (let n = 1; n <= MAX_PEOPLE_PER_ROW; n++) {
    const p = n === 1 ? '' : `person_${n}_`;
    const name =
      n === 1
        ? firstOf(raw, ['contactPerson', 'contact_person', 'directorName', 'director_name', 'person_name'])
        : firstOf(raw, [`${p}name`]);
    const title =
      n === 1
        ? firstOf(raw, ['contact_title', 'contactTitle', 'title', 'designation', 'person_title'])
        : firstOf(raw, [`${p}title`]);
    const email = n === 1 ? firstOf(raw, ['person_email', 'personEmail']) : firstOf(raw, [`${p}email`]);
    const phone = n === 1 ? firstOf(raw, ['person_phone', 'personPhone']) : firstOf(raw, [`${p}phone`]);
    const mobile = n === 1 ? firstOf(raw, ['person_mobile', 'personMobile']) : firstOf(raw, [`${p}mobile`]);
    const linkedin = n === 1 ? firstOf(raw, ['person_linkedin', 'personLinkedin']) : firstOf(raw, [`${p}linkedin`]);

    // A shared title column alone (person 1) does not make a person; person-specific fields do.
    const hasPersonFields = !!(name || email || phone || mobile || linkedin || (n > 1 && title));
    if (!hasPersonFields) continue;

    people.push({
      businessId,
      personName: name,
      jobTitle: title,
      email,
      phone,
      mobile,
      linkedinUrl: linkedin,
      source: { ...source, reference: n === 1 ? source.reference : `${source.reference}:person-${n}` },
    });
  }
  return people;
}

/**
 * Glue between the company upload pipeline and the People ingestion service.
 *
 * Contract:
 *  - runs only AFTER the business has been created and committed (never inside its transaction);
 *  - is best-effort: it NEVER throws, whatever the People layer does;
 *  - only hands over the exact `businessId` it was given (a person can never create a company);
 *  - everything ingested stays DRAFT (this bridge has no publishing capability);
 *  - is optional: without the People module wired in, or with PEOPLE_UPLOAD_INGESTION=false, it no-ops.
 */
@Injectable()
export class ImportPeopleBridge {
  private readonly logger = new Logger(ImportPeopleBridge.name);

  constructor(
    private readonly batchRepo: ImportBatchRepository,
    private readonly recordRepo: ImportRecordRepository,
    @Optional() @Inject(PEOPLE_INGESTION_SERVICE) private readonly people?: IPeopleIngestionService,
  ) {}

  async ingestForPublishedRecord(input: {
    businessId: string;
    record: { id: string; batchId: string; rowNumber: number; rawPayload: unknown; createdAt: Date };
  }): Promise<IImportPeopleResult> {
    let result: IImportPeopleResult;
    try {
      result = await this.run(input);
    } catch (err) {
      // Anything unforeseen (bad payload shape, batch lookup failure, ...) is recorded, never propagated.
      this.logger.error(`People stage failed for import record ${input?.record?.id}: ${(err as Error)?.message}`);
      result = { ...emptyPeopleResult(), attempted: true, error: (err as Error)?.message ?? 'Unknown error' };
    }

    try {
      if (result.attempted && input?.record?.id) await this.persist(input.record, result);
    } catch (err) {
      this.logger.warn(`Could not store people report: ${(err as Error)?.message}`);
    }
    return result;
  }

  private async run(input: {
    businessId: string;
    record: { id: string; batchId: string; rowNumber: number; rawPayload: unknown; createdAt: Date };
  }): Promise<IImportPeopleResult> {
    if (process.env.PEOPLE_UPLOAD_INGESTION === 'false') return emptyPeopleResult('DISABLED');
    if (!this.people) return emptyPeopleResult('NOT_CONFIGURED');

    const { record, businessId } = input;
    const raw = (record.rawPayload ?? {}) as Record<string, unknown>;
    const batch = await this.batchRepo.findById(record.batchId);
    const extracted = extractPeopleFromRow(raw, businessId, {
      sourceType: batch?.source?.type,
      batchId: record.batchId,
      filename: batch?.filename ?? 'unknown',
      rowNumber: record.rowNumber,
      observedAt: record.createdAt,
    });
    if (extracted.length === 0) return emptyPeopleResult('NO_PEOPLE');
    // Each extracted person is one source record of the registered upload source. Its id is derived from things that are
    // stable for that record (the import batch and the row / person position already in source.reference), so re-processing
    // the same import record is recognised, and a new upload is (correctly) a new source record.
    const records = extracted.map((r) => ({ ...r, source: { ...(r.source ?? {}), recordId: uploadRecordId(record.batchId, r.source?.reference) } }));

    let report: IIngestionReport;
    try {
      report = await this.people.ingest(records, {
        batchRef: `import-batch:${record.batchId}`,
        sourceLabel: `company-upload:${batch?.filename ?? 'unknown'}`.slice(0, 100),
        sourceKey: UPLOAD_SOURCE_KEY,
      });
    } catch (err) {
      // Complete failure of the People layer: every entry counts as an error, the company is untouched.
      this.logger.error(`People ingestion failed for import record ${record.id}: ${(err as Error)?.message}`);
      return {
        ...emptyPeopleResult(),
        attempted: true,
        received: records.length,
        errors: records.length,
        error: (err as Error)?.message ?? 'People ingestion failed',
        outcomes: records.map((_r, index) => ({ index, outcome: 'ERROR' })),
      };
    }

    const result: IImportPeopleResult = { ...emptyPeopleResult(), attempted: true, received: records.length };
    for (const r of report.results) {
      const codes = (r.reasons ?? []).map((x) => x.code);
      result.outcomes.push({ index: r.index, outcome: r.outcome, personId: r.personId, codes: codes.length ? codes : undefined });
      switch (r.outcome) {
        case 'CREATED': result.created++; result.accepted++; break;
        case 'UPDATED': result.updated++; result.accepted++; break;
        case 'UNCHANGED': result.unchanged++; result.accepted++; break;
        case 'QUARANTINED':
          if (codes.some((c) => HELD_CODES.has(c))) result.quarantined++;
          else result.rejected++;
          break;
        default: result.errors++;
      }
    }
    return result;
  }

  private async persist(
    record: { id: string; batchId: string },
    result: IImportPeopleResult,
  ): Promise<void> {
    try {
      await this.recordRepo.setPeopleResult(record.id, result);
    } catch (err) {
      this.logger.warn(`Could not store people result for record ${record.id}: ${(err as Error).message}`);
    }
    try {
      await this.batchRepo.addPeopleSummary(record.batchId, result);
    } catch (err) {
      this.logger.warn(`Could not update people summary for batch ${record.batchId}: ${(err as Error).message}`);
    }
  }
}
