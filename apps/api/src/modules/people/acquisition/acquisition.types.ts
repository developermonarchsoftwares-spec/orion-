import { OBSERVATION_LIMITS } from '../observations/observation-policy';
import type { IPeopleSourceAdapter } from '../sources/source.types';

export type AcquisitionRunStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

/**
 * Orchestration limits of one run. They are orchestration-level controls only: nothing here throttles the network inside an
 * adapter. `maxRunsPerHour` is the per-source rate limit (checked when a run is created); the rest are snapshotted on the run.
 */
export interface IAcquisitionLimits {
  /** Most records one run may process. Never above the ingestion hard cap. */
  maxRecords: number;
  /** Records handed to ingestion per batch (and per checkpoint). */
  batchSize: number;
  /** Declared cost units one run may spend. null = no cap. */
  maxCostUnits: number | null;
  /** Retries of a TRANSIENT failure (not counting the first attempt). */
  maxRetries: number;
  /** Deterministic backoff: base * 2^(attempt-1), no jitter, capped. */
  backoffBaseMs: number;
  /** Pause between batches. */
  batchIntervalMs: number;
  /** New runs a source may start per rolling hour. */
  maxRunsPerHour: number;
}

export const DEFAULT_ACQUISITION_LIMITS: Readonly<IAcquisitionLimits> = Object.freeze({
  maxRecords: OBSERVATION_LIMITS.MAX_RECORDS_PER_RUN,
  batchSize: 100,
  maxCostUnits: null,
  maxRetries: 3,
  backoffBaseMs: 1000,
  batchIntervalMs: 0,
  maxRunsPerHour: 60,
});

export const ACQUISITION_HARD_CAPS = Object.freeze({
  maxRecords: OBSERVATION_LIMITS.MAX_RECORDS_PER_RUN,
  batchSize: 1000,
  maxRetries: 10,
  backoffMaxMs: 60_000,
  /** A worker's claim on a RUNNING run; renewed at every checkpoint. An expired lease may be taken over. */
  leaseMs: 5 * 60_000,
});

/**
 * A source adapter as the orchestrator sees it: the Phase 6.1 contract, plus an optional DECLARED cost per record.
 * A source with no cost model declares nothing and costs zero units. There is no currency anywhere.
 */
export interface IAcquisitionAdapter extends IPeopleSourceAdapter {
  readonly costUnitsPerRecord?: number;
}

/** Codes the orchestrator never retries (deterministic outcomes); everything else that throws is treated as transient. */
export const NON_RETRYABLE_RECORD_CODES: readonly string[] = [
  'SUPPRESSED_PERSON',
  'AMBIGUOUS_IDENTITY',
  'AMBIGUOUS_COMPANY_MATCH',
  'BUSINESS_NOT_FOUND',
];

/** The only per-record outcome that is retried: an unexpected processing error (not a quarantine decision). */
export const RETRYABLE_RECORD_CODE = 'PROCESSING_ERROR';
