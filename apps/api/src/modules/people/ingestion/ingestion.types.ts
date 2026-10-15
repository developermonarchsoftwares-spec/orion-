import type { IPersonUpsertInput } from '../contracts/people-ingestion.contract';

/**
 * Raw, source-shaped people record. Every field is optional/untrusted: the normalizer decides
 * what is usable. Producers (CSV import, JSON import, admin entry, enrichment providers) only
 * need to fill this shape; they never touch the people tables.
 */
export interface IRawPersonRecord {
  // Company association: at least one is required. They are resolved against EXISTING businesses.
  businessId?: string;
  businessSlug?: string;
  /** e.g. { type: 'CIN', value: 'U12345TN2010PTC000001' } (matched on business_identifiers). */
  businessIdentifier?: { type: string; value: string };
  /**
   * Phase 6.3: what the source knows about the company, for shared company resolution when it has no Orion id / slug /
   * statutory identifier. The company's own website or domain (NOT an e-mail domain), name and location. The resolver
   * matches on exact normalised values only and never guesses; ambiguous or unmatched companies are quarantined.
   */
  company?: {
    name?: string;
    legalName?: string;
    website?: string;
    domain?: string;
    city?: string;
    state?: string;
    pincode?: string;
    /** Additional statutory identifiers beyond `businessIdentifier`. */
    identifiers?: Array<{ type: string; value: string }>;
  };

  personName?: string;
  jobTitle?: string;

  /**
   * Optional caller hints. The role classifier is the only authority for stored classification;
   * hints are validated for consistency and reported when they disagree, never adopted.
   */
  department?: string;
  seniority?: string;
  decisionMakerType?: string;

  email?: string;
  phone?: string;
  mobile?: string;
  linkedinUrl?: string;

  /** "City", "City, State" or "City, State, Country"; ignored where city/state/country are given. */
  location?: string;
  city?: string;
  state?: string;
  country?: string;

  isCurrent?: boolean | string;
  startDate?: string;
  endDate?: string;

  /** 0-100, only if the source genuinely provides one. */
  confidenceScore?: number;

  /** Provenance is mandatory: where did this claim come from? */
  source?: {
    /** GOVERNMENT_REGISTRY | WEB_SCRAPING | MANUAL_IMPORT | API_INTEGRATION | USER_SUBMISSION | PARTNER_FEED */
    type?: string;
    label?: string;
    url?: string;
    reference?: string;
    /** Defaults to ROLE_CLAIM. */
    evidenceType?: string;
    /** When the SOURCE says this was true / current. Not when Orion received it (that is acquiredAt, set by ingestion). */
    observedAt?: string | Date;
    /**
     * Phase 6.2: the source's own identifier for this record. With the source key it is the idempotency key of a source
     * record. Only keyed (registered) sources are observed; a record without an id is ingested but NOT observed, explicitly
     * (Orion never invents record ids).
     */
    recordId?: string;
    /** Phase 6.2: optional pointer to where the full payload lives (a reference, never the payload; no credentials). */
    payloadRef?: string;
  };

  /**
   * A verification that actually happened. VERIFIED / PARTIALLY_VERIFIED need verifiedAt AND
   * verifiedBy (a reviewer or provider name); otherwise the record is rejected.
   */
  verification?: {
    status?: string;
    verifiedAt?: string | Date;
    verifiedBy?: string;
  };
}

/** What a normalised record says about its company (input of the shared company resolver). */
export interface ICompanyRef {
  id?: string;
  slug?: string;
  identifier?: { type: string; value: string };
  identifiers?: Array<{ type: string; value: string }>;
  name?: string;
  legalName?: string;
  website?: string;
  domain?: string;
  city?: string;
  state?: string;
  pincode?: string;
}

export interface IReason {
  code: string;
  message: string;
  /** Machine-readable context for reviewers (for example company-match candidates). Internal only; never personal contact data. */
  details?: Record<string, unknown>;
}

export interface INormalizedRecord {
  businessRef: ICompanyRef;
  upsert: Omit<IPersonUpsertInput, 'businessId'>;
  warnings: IReason[];
}

export type NormalizeResult = { ok: true; record: INormalizedRecord } | { ok: false; reasons: IReason[] };

/** Pluggable origin of raw records. Implement this to add a CSV file, a provider API, a dataset... */
export interface IPeopleSource {
  readonly name: string;
  /**
   * Phase 6.1: the stable key of this source in the source registry (people_sources). A source that declares a key is
   * resolved against the registry on every run (registered, enabled, terms acknowledged) and every record is constrained
   * by the source's policy. A source without a key behaves exactly as before.
   */
  readonly sourceKey?: string;
  /** Informational; the registry holds the authoritative version, which is what the report records. */
  readonly sourceVersion?: string;
  records(): AsyncIterable<IRawPersonRecord> | Iterable<IRawPersonRecord>;
}

export interface IIngestionOptions {
  /** Groups a run (also stamped on quarantine rows). Defaults to a timestamped id. */
  batchRef?: string;
  /** Overrides the source label stored with quarantine rows. */
  sourceLabel?: string;
  /** Validate, normalise and resolve the company, but write nothing. */
  dryRun?: boolean;
  /**
   * Default true. When false, rejected records are reported in the result but NOT written to the
   * quarantine table (used by reviewer "retry", which manages the existing quarantine row itself).
   */
  quarantine?: boolean;
  /** Phase 6.1: registry key of the source producing these records; enables registry + policy enforcement. */
  sourceKey?: string;
  /** Phase 6.2: when Orion obtained this batch (defaults to the start of the run). */
  acquiredAt?: Date;
}

export type RecordOutcome = 'CREATED' | 'UPDATED' | 'UNCHANGED' | 'QUARANTINED' | 'VALID';

/** What happened to the observation log for one record (Phase 6.2). */
export interface IObservationStatus {
  /** RECORDED = a new observation row; DUPLICATE = this exact observation (record + content + run) already existed. */
  status: 'RECORDED' | 'DUPLICATE' | 'NOT_RECORDED';
  /** For NOT_RECORDED: UNKEYED_SOURCE (legacy caller), NO_SOURCE_RECORD_ID, DRY_RUN, MALFORMED_OR_OVERSIZED. */
  reason?: string;
}

export interface IRecordResult {
  index: number;
  outcome: RecordOutcome;
  observation?: IObservationStatus;
  personId?: string;
  companyPersonId?: string;
  reasons?: IReason[];
  warnings?: IReason[];
}

export interface IIngestionReport {
  batchRef: string;
  dryRun: boolean;
  total: number;
  /** Present only for keyed sources: which registered source (and registry version) produced the batch. */
  source?: { key: string; version: string };
  /** Present only for keyed sources. */
  observations?: { recorded: number; duplicate: number; notRecorded: number };
  /** A new person was created. */
  created: number;
  /** Existing person: new/changed role, contact or evidence. */
  updated: number;
  /** Already ingested; nothing changed. */
  unchanged: number;
  quarantined: number;
  /** Only in dry runs: records that would be written. */
  valid: number;
  results: IRecordResult[];
}

/**
 * The contract the future upload pipeline / enrichment providers call. Everything ingested is
 * DRAFT (invisible to customers) until PeoplePublishingService publishes it after review.
 */
export interface IPeopleIngestionService {
  ingest(records: IRawPersonRecord[], options?: IIngestionOptions): Promise<IIngestionReport>;
  ingestFromSource(source: IPeopleSource, options?: IIngestionOptions): Promise<IIngestionReport>;
}

export const PEOPLE_INGESTION_SERVICE = Symbol('PEOPLE_INGESTION_SERVICE');
