import {
  CONFIDENCE_HIGH_MIN,
  CONFIDENCE_MEDIUM_MIN,
  VERIFICATION_STALE_AFTER_DAYS,
  type AssertionLevel,
  type ConfidenceLevel,
  type VerificationStatus,
} from '../people.constants';

export interface IEffectiveVerificationInput {
  /** Status as stored (set by the pipeline / a reviewer). */
  status: VerificationStatus;
  lastVerifiedAt?: Date | string | null;
  /** Number of evidence rows with verified_at set that support this record. */
  verifiedEvidenceCount: number;
  now?: Date;
}

/**
 * Customer-facing verification status. A stored VERIFIED / PARTIALLY_VERIFIED is only honoured
 * when it is backed by at least one verified evidence row and a verification timestamp;
 * otherwise it is downgraded to UNVERIFIED. Old verifications are reported as STALE.
 * A CONFLICTED record always stays CONFLICTED.
 */
export function effectiveVerification(input: IEffectiveVerificationInput): VerificationStatus {
  const { status, verifiedEvidenceCount } = input;
  const now = input.now ?? new Date();

  if (status === 'CONFLICTED') return 'CONFLICTED';
  if (status === 'UNVERIFIED' || status === 'STALE') return status;

  // VERIFIED or PARTIALLY_VERIFIED claims need evidence and a verification date.
  const verifiedAt = input.lastVerifiedAt ? new Date(input.lastVerifiedAt) : null;
  if (verifiedEvidenceCount <= 0 || !verifiedAt || Number.isNaN(verifiedAt.getTime())) {
    return 'UNVERIFIED';
  }
  const ageDays = (now.getTime() - verifiedAt.getTime()) / 86_400_000;
  if (ageDays > VERIFICATION_STALE_AFTER_DAYS) return 'STALE';
  return status;
}

/** Score band; unverified / conflicted data is capped so the UI never shows HIGH for unsupported claims. */
export function confidenceLevel(score: number, effective: VerificationStatus): ConfidenceLevel {
  const s = Number.isFinite(score) ? score : 0;
  let level: ConfidenceLevel = s >= CONFIDENCE_HIGH_MIN ? 'HIGH' : s >= CONFIDENCE_MEDIUM_MIN ? 'MEDIUM' : 'LOW';
  if (effective === 'CONFLICTED') return 'LOW';
  if ((effective === 'UNVERIFIED' || effective === 'STALE') && level === 'HIGH') level = 'MEDIUM';
  return level;
}

/** Known = verified with evidence. Likely = partially verified. Everything else is Unverified. */
export function assertionLevel(effective: VerificationStatus): AssertionLevel {
  if (effective === 'VERIFIED') return 'KNOWN';
  if (effective === 'PARTIALLY_VERIFIED') return 'LIKELY';
  return 'UNVERIFIED';
}

export function decisionMakerClaimLabel(typeLabel: string, assertion: AssertionLevel): string {
  if (assertion === 'KNOWN') return `Decision maker · ${typeLabel}`;
  if (assertion === 'LIKELY') return `Likely decision maker · ${typeLabel}`;
  return `Unverified role · ${typeLabel}`;
}
