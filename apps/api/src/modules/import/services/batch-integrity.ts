import { IPeopleIngestionSummary } from '../people/import-people.types';

export interface IBatchIntegrityInput {
  totalRows: number;
  recordCount: number;
  successful: number;
  /** Clean rows waiting in the publish queue for an administrator (Phase 15). */
  queued?: number;
  duplicates: number;
  failed: number;
  businessesPublished: number;
  peopleSummary: IPeopleIngestionSummary | null | undefined;
}

export interface IBatchIntegrity {
  ok: boolean;
  issues: string[];
}

/**
 * Cross-checks what a finished batch reports against what is stored. Any mismatch is returned (and the caller logs it and
 * flags the batch) so a batch can never look successful while its audit trail is incomplete.
 */
export function assessBatchIntegrity(i: IBatchIntegrityInput): IBatchIntegrity {
  const issues: string[] = [];
  if (i.recordCount !== i.totalRows) issues.push(`import_records ${i.recordCount} != rows submitted ${i.totalRows}`);
  const queued = i.queued ?? 0;
  if (i.successful + queued + i.duplicates + i.failed !== i.totalRows) {
    issues.push(`outcomes ${i.successful}+${queued}+${i.duplicates}+${i.failed} != rows submitted ${i.totalRows}`);
  }
  if (i.businessesPublished !== i.successful) issues.push(`published records ${i.businessesPublished} != accepted rows ${i.successful}`);
  if (!i.peopleSummary) issues.push('people_summary was not generated');
  return { ok: issues.length === 0, issues };
}
