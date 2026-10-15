/**
 * Shared vocabularies for the People / Decision-Maker layer.
 * These are plain string unions (stored as varchar) so the taxonomy can evolve without
 * a database enum migration. The database only constrains verification status (pg enum).
 */

export const VERIFICATION_STATUSES = [
  'UNVERIFIED',
  'PARTIALLY_VERIFIED',
  'VERIFIED',
  'STALE',
  'CONFLICTED',
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const CONFIDENCE_LEVELS = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

/** How strongly Orion asserts a fact to the customer. Drives the "Known / Likely / Unverified" UI. */
export const ASSERTION_LEVELS = ['KNOWN', 'LIKELY', 'UNVERIFIED'] as const;
export type AssertionLevel = (typeof ASSERTION_LEVELS)[number];

export const SENIORITY_LEVELS = ['EXECUTIVE', 'DIRECTOR', 'HEAD', 'MANAGER', 'STAFF', 'UNKNOWN'] as const;
export type SeniorityLevel = (typeof SENIORITY_LEVELS)[number];

export const DEPARTMENTS = [
  'EXECUTIVE',
  'SALES',
  'MARKETING',
  'BUSINESS_DEVELOPMENT',
  'TECHNOLOGY',
  'OPERATIONS',
  'FINANCE',
  'HR',
  'PROCUREMENT',
  'LEGAL',
  'OTHER',
  'UNKNOWN',
] as const;
export type Department = (typeof DEPARTMENTS)[number];

export const DECISION_MAKER_TYPES = [
  'FOUNDER_CEO',
  'MANAGING_DIRECTOR',
  'DIRECTOR_PARTNER',
  'GENERAL_MANAGER',
  'SALES_DECISION_MAKER',
  'MARKETING_DECISION_MAKER',
  'BUSINESS_DEVELOPMENT_DECISION_MAKER',
  'TECHNOLOGY_DECISION_MAKER',
  'OPERATIONS_DECISION_MAKER',
  'FINANCE_DECISION_MAKER',
  'HR_DECISION_MAKER',
  'PROCUREMENT_DECISION_MAKER',
] as const;
export type DecisionMakerType = (typeof DECISION_MAKER_TYPES)[number];

export const RELATIONSHIP_TYPES = [
  'OWNER',
  'FOUNDER',
  'EXECUTIVE',
  'DIRECTOR',
  'PARTNER',
  'EMPLOYEE',
  'ADVISOR',
  'OTHER',
] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

export const CONTACT_TYPES = ['WORK_EMAIL', 'PHONE', 'MOBILE'] as const;
export type ContactType = (typeof CONTACT_TYPES)[number];

export const PERSON_DATA_STATUSES = ['DRAFT', 'PUBLISHED', 'SUPPRESSED'] as const;
export type PersonDataStatus = (typeof PERSON_DATA_STATUSES)[number];

/** Credits charged to reveal one person's published contact points (same wallet as lead unlocks). */
export const PERSON_UNLOCK_COST_CREDITS = 1;

/** A verification older than this is reported as STALE instead of VERIFIED / PARTIALLY_VERIFIED. */
export const VERIFICATION_STALE_AFTER_DAYS = 365;

/** Confidence score (0-100) thresholds. */
export const CONFIDENCE_MEDIUM_MIN = 40;
export const CONFIDENCE_HIGH_MIN = 75;
