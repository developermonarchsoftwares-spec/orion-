import type { ContactType, PersonDataStatus, RelationshipType, VerificationStatus } from '../people.constants';

/**
 * Contract for the (future, Phase 2) pipeline stage:
 *
 *   ... DEDUPLICATION -> ENTITY RESOLUTION -> PEOPLE ENRICHMENT -> VERIFICATION -> PUBLISHING
 *
 * The upload / enrichment pipeline calls IPeopleIngestionPort; it never writes people tables
 * directly. Implemented by PeopleWriteService. There is intentionally NO HTTP endpoint for this:
 * customers can only read the published output.
 */

export type EvidenceSourceType =
  | 'GOVERNMENT_REGISTRY'
  | 'WEB_SCRAPING'
  | 'MANUAL_IMPORT'
  | 'API_INTEGRATION'
  | 'USER_SUBMISSION'
  | 'PARTNER_FEED';

export interface IEvidenceInput {
  sourceType: EvidenceSourceType;
  /** e.g. REGISTRY_FILING | COMPANY_WEBSITE | PROFESSIONAL_PROFILE | MANUAL_REVIEW | EMAIL_CHECK */
  evidenceType: string;
  /** Kept internal; never exposed to customers. */
  sourceUrl?: string;
  sourceReference?: string;
  observedAt?: Date;
  /** Set ONLY when a human or an automated check actually verified the claim. */
  verifiedAt?: Date;
  confidenceScore?: number;
  /**
   * ROLE (default): supports the person-at-company role.
   * PERSON: supports the person generally (does NOT verify any role).
   * CONTACT: supports one contact point; requires `contact`.
   */
  scope?: 'ROLE' | 'PERSON' | 'CONTACT';
  contact?: { type: ContactType; value: string };
}

export interface IContactInput {
  type: ContactType;
  value: string;
  isPrimary?: boolean;
  sourceType?: EvidenceSourceType;
  verificationStatus?: VerificationStatus;
  confidenceScore?: number;
  lastVerifiedAt?: Date;
  /** Contact points are hidden from customers until published. Default false. */
  isPublished?: boolean;
}

/**
 * Phase 6.2: the observation that produced this write. The writer records it INSIDE the same transaction as the person /
 * role / evidence writes, so a keyed record can never be written without a traceable observation (and vice versa).
 */
export interface IObservationInput {
  sourceKey: string;
  /** Registry version at the time; never rewritten later. */
  sourceVersion: string;
  sourceRecordId: string;
  batchRef: string;
  acquiredAt: Date;
  observedAt: Date | null;
  contentFingerprint: string;
  payloadBytes: number;
  payloadRef?: string;
}

export interface IPersonUpsertInput {
  businessId: string;
  person: {
    fullName: string;
    linkedinUrl?: string;
    photoUrl?: string;
    city?: string;
    state?: string;
    country?: string;
  };
  role: {
    jobTitle: string;
    isCurrent?: boolean;
    startDate?: string;
    endDate?: string;
    /** Overrides the value inferred from the title. */
    relationshipType?: RelationshipType;
  };
  contacts?: IContactInput[];
  evidence?: IEvidenceInput[];
  /** Verification claim for the role. Clamped to UNVERIFIED when no verified evidence backs it. */
  verificationStatus?: VerificationStatus;
  confidenceScore?: number;
  lastVerifiedAt?: Date;
  /** Phase 6.2: recorded atomically with the write when present (keyed sources only). */
  observation?: IObservationInput;
  /**
   * Legacy / trusted-caller switch: `PUBLISHED` makes the person AND this role customer-visible in
   * one step. Leave undefined (the default) for DRAFT. The ingestion layer never sets it; publishing
   * goes through PeoplePublishingService after review.
   */
  dataStatus?: PersonDataStatus;
}

export interface IPersonUpsertResult {
  personId: string;
  companyPersonId: string;
  personCreated: boolean;
  roleCreated: boolean;
  contactsCreated: number;
  evidenceCreated: number;
  /** The verification status actually stored (after evidence clamping and no-downgrade rules). */
  storedVerificationStatus: VerificationStatus;
  /** True when nothing new was written (a repeat of an already-ingested record). */
  unchanged: boolean;
  /** Non-fatal observations: dropped contacts, identity conflicts, etc. */
  warnings: string[];
  /** Phase 6.2: present only when an observation was supplied. `duplicate` = this exact observation already existed. */
  observation?: { id: string | null; recorded: boolean; duplicate: boolean };
}

export interface IPeopleIngestionPort {
  upsertPersonForBusiness(input: IPersonUpsertInput): Promise<IPersonUpsertResult>;
  setDataStatus(personId: string, status: PersonDataStatus): Promise<void>;
}

export const PEOPLE_INGESTION_PORT = Symbol('PEOPLE_INGESTION_PORT');
