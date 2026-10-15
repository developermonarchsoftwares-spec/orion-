import type { EvidenceSourceType } from '../contracts/people-ingestion.contract';
import type { IPeopleSource, IRawPersonRecord } from '../ingestion/ingestion.types';

/**
 * SOURCE REGISTRY + SOURCE CONTRACT (Phase 6.1)
 *
 *   SOURCE (described by the registry)  ->  ADAPTER (supplies records)  ->  IRawPersonRecord
 *        ->  PeopleIngestionService (the only canonical writer)  ->  existing People pipeline
 *
 * A source PROVIDES DATA. It never writes people, roles, contacts, evidence, verification, review or publication state,
 * and it holds no credentials: secrets belong in the runtime environment of the adapter, never in these rows, in policy
 * JSON, or in evidence.
 */

/** Reuses the existing evidence / data-source categories: no new taxonomy. */
export type SourceType = EvidenceSourceType;
export const SOURCE_TYPES: readonly SourceType[] = ['GOVERNMENT_REGISTRY', 'WEB_SCRAPING', 'MANUAL_IMPORT', 'API_INTEGRATION', 'USER_SUBMISSION', 'PARTNER_FEED'];

/** Relative cost of asking this source for a record. Used by future cost control; informational in 6.1. */
export const SOURCE_COST_CLASSES = ['NONE', 'LOW', 'MEDIUM', 'HIGH'] as const;
export type SourceCostClass = (typeof SOURCE_COST_CLASSES)[number];

/**
 * The most a source may attest, however it labels its own records.
 *   NONE    the source cannot attest anything; any verification it sends is dropped
 *   PARTIAL at most PARTIALLY_VERIFIED (VERIFIED is capped down to it)
 *   FULL    VERIFIED / PARTIALLY_VERIFIED may be relayed as system attestation
 * Attestation is always a SYSTEM event; it is never human verification.
 */
export const MAX_ATTESTATION_LEVELS = ['NONE', 'PARTIAL', 'FULL'] as const;
export type MaxAttestation = (typeof MAX_ATTESTATION_LEVELS)[number];

/** What a source may claim. Explicit and deny-by-default: anything not `true` is not permitted. */
export interface ISourcePermissions {
  identity: boolean; // person name
  title: boolean; // job title
  email: boolean;
  phone: boolean; // phone and mobile
  linkedin: boolean;
  evidence: boolean; // source url / reference / evidence type / observed date
  attestation: boolean; // the `verification` block (still capped by maxAttestation)
}
export const PERMISSION_KEYS: readonly (keyof ISourcePermissions)[] = ['identity', 'title', 'email', 'phone', 'linkedin', 'evidence', 'attestation'];

export interface ISourcePolicy {
  permissions: ISourcePermissions;
  /** When true, the registered source type replaces whatever type a record claims (a source cannot pose as a registry). */
  enforceSourceType: boolean;
  /** Evidence types the source may emit. null = unrestricted, allowed only for internal, human-supplied source types. */
  allowedEvidenceTypes: string[] | null;
  maxAttestation: MaxAttestation;
}

export interface ISourceDefinition {
  id: string;
  key: string;
  displayName: string;
  sourceType: SourceType;
  version: string;
  enabled: boolean;
  termsReference: string | null;
  /** null = licence / terms not acknowledged: the source cannot be enabled or used. */
  termsAcknowledgedAt: Date | null;
  costClass: SourceCostClass;
  /** After this many days an observation from the source should be treated as needing a refresh. null = none. */
  freshnessTtlDays: number | null;
  policy: ISourcePolicy;
  createdAt: Date;
  updatedAt: Date;
}

/** Registration input. Nothing is granted unless stated; there are deliberately no credential fields. */
export interface INewSource {
  key: string;
  displayName: string;
  sourceType: SourceType;
  version?: string;
  termsReference?: string;
  /** Registering with `termsAcknowledged: true` records the acknowledgement time; otherwise the source stays disabled. */
  termsAcknowledged?: boolean;
  enabled?: boolean;
  costClass?: SourceCostClass;
  freshnessTtlDays?: number | null;
  policy: {
    permissions: Partial<ISourcePermissions>;
    enforceSourceType?: boolean;
    allowedEvidenceTypes?: string[] | null;
    maxAttestation?: MaxAttestation;
  };
}

// --------------------------------------------------------------------------------------------- adapter contract

/**
 * One record as a source hands it over. `mapped` is the EXISTING canonical shape; everything else is carried for the
 * observation storage of a later phase (6.2) and is not persisted by 6.1.
 */
export interface ISourceRecord {
  sourceRecordId?: string;
  observedAt?: Date | string;
  payload?: unknown;
  mapped: IRawPersonRecord;
}

export interface ISourceBatch {
  acquiredAt: Date;
  records: ISourceRecord[];
  /** Opaque resume cursor for the next fetch. */
  cursor?: string;
}

/**
 * The source contract. It is the existing IPeopleSource plus identity: a source that declares a `sourceKey` is resolved
 * against the registry and constrained by its policy on every run. An adapter has no database, no People service and no
 * publication capability by construction: it can only return records.
 */
export interface IPeopleSourceAdapter extends IPeopleSource {
  readonly sourceKey: string;
  readonly sourceVersion?: string;
  /** Paged acquisition with a resume cursor. Declared for later phases; not consumed by ingestion yet. */
  fetch?(cursor?: string): Promise<ISourceBatch>;
}

export const SOURCE_DEFAULT_VERSION = '1';
