/**
 * SHARED COMPANY RESOLUTION (Phase 6.3)
 *
 * Decides which EXISTING company a piece of external data is about, or that it cannot tell. Read-only and generic:
 * it never creates or edits a company or a person, never picks a winner between plausible companies, and is used by
 * People ingestion today and by future source adapters / enrichment. Precision over recall: a missed company is
 * reviewable, a person attached to the wrong company contaminates the dataset.
 */

/** What the caller knows about the company. Every field is optional; nothing is guessed from missing fields. */
export interface ICompanyCandidate {
  /** Orion's own company id / slug (internal references, strongest). */
  id?: string;
  slug?: string;
  /** Statutory / registry identifiers (type as in business_identifiers, e.g. CIN, GSTIN, UDYAM). */
  identifiers?: Array<{ type: string; value: string }>;
  /** The company's OWN website or domain. An e-mail domain is never a valid input here. */
  website?: string;
  domain?: string;
  name?: string;
  legalName?: string;
  /** Supporting location evidence; only ever corroborates a name, never identifies a company by itself. */
  city?: string;
  state?: string;
  pincode?: string;
}

export type CompanyResolutionStatus = 'MATCHED' | 'AMBIGUOUS' | 'NOT_FOUND';

/** How a company was matched. */
export type CompanyMatchMethod =
  | 'INTERNAL_ID'
  | 'INTERNAL_SLUG'
  | `IDENTIFIER:${string}`
  | 'DOMAIN'
  | 'NAME_AND_LOCATION';

export interface ICompanyMatch {
  companyId: string;
  matchedBy: CompanyMatchMethod | 'NAME';
  /** Machine-readable reasons this company is a candidate. */
  reasonCodes: string[];
}

export interface ICompanyResolution {
  status: CompanyResolutionStatus;
  /** Only for MATCHED: exactly one company, deterministically. */
  companyId?: string;
  matchedBy?: CompanyMatchMethod;
  /** Only for AMBIGUOUS: every plausible company, in a stable order. The resolver NEVER selects one. */
  candidates?: ICompanyMatch[];
  /** Machine-readable explanation for every outcome (also for MATCHED: informational notes). */
  reasonCodes: string[];
}

/** Reason codes (stable, machine-readable). */
export const COMPANY_REASON = {
  NO_SIGNAL: 'NO_COMPANY_SIGNAL',
  CONFLICTING_REFERENCES: 'CONFLICTING_COMPANY_REFERENCES',
  CONFLICTING_IDENTIFIER: 'CONFLICTING_IDENTIFIER',
  CONFLICTING_DOMAIN: 'CONFLICTING_DOMAIN',
  SHARED_DOMAIN: 'SHARED_DOMAIN',
  DOMAIN_NOT_IDENTIFYING: 'DOMAIN_NOT_IDENTIFYING',
  IDENTIFIER_NOT_FOUND: 'IDENTIFIER_NOT_FOUND',
  IDENTIFIER_IGNORED: 'IDENTIFIER_TYPE_NOT_USED',
  NAME_NOT_USABLE: 'NAME_NOT_USABLE',
  NAME_NOT_FOUND: 'NAME_NOT_FOUND',
  NAME_NEEDS_CORROBORATION: 'NAME_MATCH_NEEDS_CORROBORATION',
  NAME_DIFFERENT_LOCATION: 'NAME_MATCH_DIFFERENT_LOCATION',
  DUPLICATE_NAME_SAME_LOCATION: 'DUPLICATE_COMPANY_NAME_SAME_LOCATION',
  NAME_DIFFERS_FROM_DOMAIN_OWNER: 'NAME_DIFFERS_FROM_DOMAIN_OWNER',
  CANDIDATES_TRUNCATED: 'CANDIDATES_TRUNCATED',
} as const;

export const MAX_CANDIDATES = 20;
