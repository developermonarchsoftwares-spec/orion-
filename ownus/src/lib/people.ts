/**
 * Types and pure helpers for the People / Decision Maker layer.
 * The API decides what a customer may see; nothing here unlocks or infers data.
 */

export type VerificationStatus = 'UNVERIFIED' | 'PARTIALLY_VERIFIED' | 'VERIFIED' | 'STALE' | 'CONFLICTED';
export type AssertionLevel = 'KNOWN' | 'LIKELY' | 'UNVERIFIED';
export type ConfidenceLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface ContactField {
  available: boolean;
  verificationStatus: VerificationStatus | null;
  /** null unless this person is unlocked for the current user. */
  value: string | null;
}

export interface PersonCard {
  id: string;
  businessId: string;
  fullName: string;
  jobTitle: string;
  additionalRoles: string[];
  department: { key: string; label: string };
  seniority: { key: string; label: string };
  decisionMaker: { type: string; label: string; assertion: AssertionLevel; claim: string } | null;
  isCurrent: boolean;
  startDate: string | null;
  endDate: string | null;
  location: { city: string | null; state: string | null; country: string | null };
  verification: {
    status: VerificationStatus;
    assertion: AssertionLevel;
    lastVerifiedAt: string | null;
    confidence: { score: number; level: ConfidenceLevel };
  };
  evidence: { count: number; verifiedCount: number };
  relevance: string;
  contacts: {
    isUnlocked: boolean;
    email: ContactField;
    phone: ContactField;
    mobile: ContactField;
    linkedin: ContactField;
  };
  isSaved: boolean;
  unlockCostCredits: number;
}

export interface CompanyPeopleResponse {
  business: { id: string; slug: string; name: string };
  summary: { total: number; decisionMakers: number; verified: number; withContact: number };
  facets: {
    decisionMakerTypes: Array<{ key: string; count: number }>;
    departments: Array<{ key: string; count: number }>;
    seniority: Array<{ key: string; count: number }>;
  };
  people: PersonCard[];
  pagination: { page: number; limit: number; totalItems: number; totalPages: number };
}

export interface PeopleTaxonomy {
  departments: Array<{ key: string; label: string }>;
  seniorityLevels: Array<{ key: string; label: string }>;
  decisionMakerTypes: Array<{ key: string; label: string }>;
  verificationStatuses: Array<{ key: VerificationStatus }>;
  unlockCostCredits: number;
}

export interface PeopleFilters {
  q: string;
  department: string;
  seniority: string;
  decisionMakerType: string;
  verification: string;
  status: 'current' | 'former' | 'all';
  hasContact: boolean;
  decisionMakersOnly: boolean;
  page: number;
}

export const DEFAULT_PEOPLE_FILTERS: PeopleFilters = {
  q: '',
  department: '',
  seniority: '',
  decisionMakerType: '',
  verification: '',
  status: 'current',
  hasContact: false,
  decisionMakersOnly: false,
  page: 1,
};

/** Only non-default filters are sent, so the URL stays clean and the API defaults apply. */
export function buildPeopleQuery(filters: PeopleFilters, limit = 12): Record<string, string> {
  const out: Record<string, string> = { limit: String(limit), page: String(filters.page) };
  if (filters.q.trim()) out.q = filters.q.trim();
  if (filters.department) out.department = filters.department;
  if (filters.seniority) out.seniority = filters.seniority;
  if (filters.decisionMakerType) out.decisionMakerType = filters.decisionMakerType;
  if (filters.verification) out.verification = filters.verification;
  if (filters.status !== 'current') out.status = filters.status;
  if (filters.hasContact) out.hasContact = 'true';
  if (filters.decisionMakersOnly) out.decisionMakersOnly = 'true';
  return out;
}

export const hasActiveFilters = (f: PeopleFilters): boolean =>
  JSON.stringify({ ...f, page: 1 }) !== JSON.stringify(DEFAULT_PEOPLE_FILTERS);

/** How strongly Orion stands behind a claim. Never upgrade wording beyond the API's assertion. */
export function assertionCopy(assertion: AssertionLevel): { label: string; hint: string } {
  switch (assertion) {
    case 'KNOWN':
      return { label: 'Known', hint: 'Verified against evidence' };
    case 'LIKELY':
      return { label: 'Likely', hint: 'Partially verified' };
    default:
      return { label: 'Unverified', hint: 'Not verified yet' };
  }
}

export function verificationCopy(status: VerificationStatus | null): string {
  switch (status) {
    case 'VERIFIED':
      return 'Verified';
    case 'PARTIALLY_VERIFIED':
      return 'Partly verified';
    case 'STALE':
      return 'Needs re-verification';
    case 'CONFLICTED':
      return 'Conflicting sources';
    default:
      return 'Unverified';
  }
}

export function confidenceCopy(level: ConfidenceLevel): string {
  return level === 'HIGH' ? 'High' : level === 'MEDIUM' ? 'Medium' : 'Low';
}

export function lastVerifiedCopy(iso: string | null, now: Date = new Date()): string {
  if (!iso) return 'Never verified';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return 'Never verified';
  const days = Math.floor((now.getTime() - then.getTime()) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 60) return `${days} days ago`;
  if (days < 730) return `${Math.round(days / 30)} months ago`;
  return `${Math.round(days / 365)} years ago`;
}

export const hasAnyContact = (p: PersonCard): boolean =>
  p.contacts.email.available || p.contacts.phone.available || p.contacts.mobile.available || p.contacts.linkedin.available;

export function personInitials(fullName: string): string {
  const parts = fullName.replace(/[^\p{L}\s]/gu, '').split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}
