import { createHash } from 'crypto';
import { VERIFICATION_STALE_AFTER_DAYS, type VerificationStatus } from '../people.constants';

/**
 * Field-level verification rules (Phase 5). Pure functions and constants only: no database access.
 *
 * APPROVAL != VERIFICATION. Approval (review_status / is_published) says an internal reviewer permits
 * publication. Verification says a specific claim is supported by specific evidence. They are
 * separate decisions with separate audit entries, and neither implies the other.
 */

export const CLAIM_TYPES = ['IDENTITY', 'RELATIONSHIP', 'TITLE', 'EMAIL', 'PHONE', 'LINKEDIN'] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

/** UNVERIFIED (no decision) | VERIFIED | NEEDS_REVIEW (the value changed after it was verified) | STALE (old) | DISPUTED. */
export type ClaimState = 'UNVERIFIED' | 'VERIFIED' | 'NEEDS_REVIEW' | 'STALE' | 'DISPUTED';

export const CLAIM_LABELS: Record<ClaimType, string> = {
  IDENTITY: 'Identity',
  RELATIONSHIP: 'Company relationship',
  TITLE: 'Job title',
  EMAIL: 'Work email',
  PHONE: 'Phone',
  LINKEDIN: 'LinkedIn',
};

/**
 * Evidence types that can support a claim. The ingestion-created types (UPLOAD_ROW, ROLE_CLAIM,
 * IDENTITY_CLAIM, CONTACT_CLAIM) are deliberately absent: they record what was CLAIMED, so they can
 * never verify the claim they came with. Format validity (regex, E.164, URL shape) is not evidence.
 */
const REGISTRY_LIKE = ['REGISTRY_FILING', 'DOCUMENT', 'DIRECT_CONFIRMATION', 'COMPANY_WEBSITE', 'PROFESSIONAL_PROFILE'] as const;
export const ACCEPTED_EVIDENCE: Record<ClaimType, readonly string[]> = {
  IDENTITY: REGISTRY_LIKE,
  RELATIONSHIP: REGISTRY_LIKE,
  TITLE: REGISTRY_LIKE,
  EMAIL: ['DIRECT_CONFIRMATION', 'EMAIL_DELIVERY_CHECK', 'COMPANY_WEBSITE', 'REGISTRY_FILING', 'DOCUMENT'],
  PHONE: ['DIRECT_CONFIRMATION', 'COMPANY_WEBSITE', 'REGISTRY_FILING', 'DOCUMENT'],
  // The customer-facing "LinkedIn verified" flag is derived from PROFESSIONAL_PROFILE evidence.
  LINKEDIN: ['PROFESSIONAL_PROFILE'],
};

/** Higher is stronger. Used only to stop weaker evidence replacing stronger evidence. */
export const EVIDENCE_STRENGTH: Record<string, number> = {
  REGISTRY_FILING: 3,
  DIRECT_CONFIRMATION: 3,
  DOCUMENT: 3,
  COMPANY_WEBSITE: 2,
  PROFESSIONAL_PROFILE: 2,
  EMAIL_DELIVERY_CHECK: 2,
};

/**
 * PROVISIONAL BUSINESS POLICY - NOT approved for the long term. These numbers are engineering placeholders that need
 * product / data-quality sign-off before they are treated as permanent. Do not build on them as if they were settled.
 * Every number the verification model uses is defined in this file (or people.constants.ts).
 *
 * Confidence floors: when claims are verified the stored confidence_score is raised to AT LEAST this value
 * (never lowered by a verification; existing higher confidence is kept). Used only by reconcileRole /
 * reconcileContact. Below the floor (no verified claim) nothing is raised: confidence stays whatever the
 * source supplied.
 *   ROLE_ONE_CLAIM   70  role with exactly one of TITLE / RELATIONSHIP verified
 *   ROLE_BOTH_CLAIMS 85  role with both verified
 *   CONTACT          80  contact whose EMAIL / PHONE claim is verified
 * Identity and LinkedIn claims do not raise any score (they are not part of the role or contact statuses).
 * The 40 / 75 confidence LEVEL bands (medium / high) are separate constants in people.constants.ts.
 *
 * Also PROVISIONAL: the evidence strengths below (3 registry/document/direct, 2 website/profile/delivery check, 0 otherwise),
 * VERIFICATION_STALE_AFTER_DAYS (365, people.constants.ts) and ATTESTED_ROLE_CLAIMS. The technical guarantees (evidence-backed,
 * no downgrade, audit, concurrency safety, customer isolation) do NOT depend on the specific values.
 */
export const CONFIDENCE_FLOOR = { ROLE_ONE_CLAIM: 70, ROLE_BOTH_CLAIMS: 85, CONTACT: 80 } as const;

/**
 * PROVISIONAL BUSINESS POLICY. How a source-attested role status (ingestion) is expressed as claims. Ingestion has only a role-level
 * status, so the mapping is explicit policy: VERIFIED covers both role claims, PARTIALLY_VERIFIED covers the
 * company relationship only. Recorded as SYSTEM events (method INGESTION_ATTESTED), never as a reviewer.
 */
export const ATTESTED_ROLE_CLAIMS: Record<'VERIFIED' | 'PARTIALLY_VERIFIED', readonly ('TITLE' | 'RELATIONSHIP')[]> = {
  VERIFIED: ['TITLE', 'RELATIONSHIP'],
  PARTIALLY_VERIFIED: ['RELATIONSHIP'],
};

export const SYSTEM_LABELS = { INGESTION: 'system:ingestion', LEGACY: 'system:legacy-backfill' } as const;

/** Contact data (email / phone / LinkedIn) is never copied into the ledger: only a digest, for change detection. */
export const SENSITIVE_CLAIMS: readonly ClaimType[] = ['EMAIL', 'PHONE', 'LINKEDIN'];
export const claimedValueFor = (claim: ClaimType, value: string): string =>
  SENSITIVE_CLAIMS.includes(claim) ? `h:${createHash('sha256').update(value, 'utf8').digest('hex')}` : value;

export const evidenceStrength = (evidenceType: string) => EVIDENCE_STRENGTH[evidenceType] ?? 0;

export function isEvidenceAccepted(claim: ClaimType, evidenceType: string): boolean {
  return ACCEPTED_EVIDENCE[claim].includes(evidenceType);
}

export interface ILedgerRow {
  id: string;
  claimType: string;
  targetKey: string;
  claimedValue: string;
  status: string; // VERIFIED | DISPUTED
  evidenceId: string | null;
  evidenceStrength: number;
  verifiedByLabel: string;
  verifiedByKind: string; // REVIEWER | SYSTEM
  method: string;
  attestedBy: string | null;
  verifiedAt: Date;
  note: string;
}

export const targetKeyOf = (claim: ClaimType, target: { personId: string; roleId?: string; contactId?: string }): string => {
  switch (claim) {
    case 'IDENTITY':
    case 'LINKEDIN':
      return `${claim}:${target.personId}`;
    case 'RELATIONSHIP':
    case 'TITLE':
      return `${claim}:${target.roleId}`;
    default:
      return `${claim}:${target.contactId}`;
  }
};

/**
 * State of one claim from its ledger rows. Rows are per (target, value): if the current value has a
 * row, that row decides; if only rows for OTHER values exist, the value changed after verification
 * and the claim needs review (it is never silently treated as verified).
 */
export function claimState(
  rows: ILedgerRow[],
  currentValue: string | null,
  now: Date = new Date(),
  opts: { ignoreAge?: boolean } = {},
): { state: ClaimState; row: ILedgerRow | null; previousValue: string | null } {
  if (!rows.length || currentValue === null) return { state: 'UNVERIFIED', row: null, previousValue: null };
  const match = rows.find((r) => r.claimedValue === currentValue);
  if (!match) {
    const latest = [...rows].sort((a, b) => b.verifiedAt.getTime() - a.verifiedAt.getTime())[0];
    return { state: 'NEEDS_REVIEW', row: null, previousValue: latest.claimedValue };
  }
  if (match.status === 'DISPUTED') return { state: 'DISPUTED', row: match, previousValue: null };
  const ageDays = (now.getTime() - match.verifiedAt.getTime()) / 86_400_000;
  return { state: !opts.ignoreAge && ageDays > VERIFICATION_STALE_AFTER_DAYS ? 'STALE' : 'VERIFIED', row: match, previousValue: null };
}

/** Role-level status derived from the two role claims. Never lowers on its own: callers apply max-rank. */
export function roleStatusFromClaims(states: { RELATIONSHIP: ClaimState; TITLE: ClaimState }): 'VERIFIED' | 'PARTIALLY_VERIFIED' | 'UNVERIFIED' {
  const ok = (s: ClaimState) => s === 'VERIFIED';
  if (ok(states.RELATIONSHIP) && ok(states.TITLE)) return 'VERIFIED';
  if (ok(states.RELATIONSHIP) || ok(states.TITLE)) return 'PARTIALLY_VERIFIED';
  return 'UNVERIFIED';
}

/**
 * THE rule tying the ledger to the operational status columns (single source of truth = the ledger).
 * Time-independent on purpose (a stored column cannot age by itself); staleness is applied at read time
 * (claimState for reviewers, effectiveVerification for customers).
 *   role    : any role claim DISPUTED -> CONFLICTED; both TITLE and RELATIONSHIP verified -> VERIFIED;
 *             one -> PARTIALLY_VERIFIED; otherwise UNVERIFIED.
 *   contact : its EMAIL/PHONE claim (for the CURRENT value) VERIFIED -> VERIFIED; DISPUTED -> CONFLICTED; else UNVERIFIED.
 */
export function deriveRoleStatus(states: { RELATIONSHIP: ClaimState; TITLE: ClaimState }): VerificationStatus {
  if (states.RELATIONSHIP === 'DISPUTED' || states.TITLE === 'DISPUTED') return 'CONFLICTED';
  return roleStatusFromClaims(states);
}

export function deriveContactStatus(state: ClaimState): VerificationStatus {
  return state === 'DISPUTED' ? 'CONFLICTED' : state === 'VERIFIED' ? 'VERIFIED' : 'UNVERIFIED';
}
