import type { DecisionMakerType, Department, SeniorityLevel } from '../people.constants';
import { TAXONOMY_V1 } from './taxonomies/v1';

/**
 * Role taxonomy configuration.
 *
 * The RULES (aliases, seniority, department, decision-maker) now live in versioned, immutable taxonomy files under
 * ./taxonomies (see docs/PEOPLE_CLASSIFICATION_VERSIONING.md). The exports below are read-only views of v1 kept for the
 * consumers that only need the data (the record normalizer's minimum-seniority check). Labels and the customer search phrases
 * are presentation, not classification rules, and stay here unversioned.
 */

export const SENIORITY_RANK: Record<SeniorityLevel, number> = TAXONOMY_V1.seniorityRank;

/** Functional decision-maker rules of taxonomy v1: department + minimum seniority. */
export const FUNCTIONAL_RULES: Partial<Record<Department, { type: DecisionMakerType; minSeniority: SeniorityLevel }>> =
  TAXONOMY_V1.functionalRules;

/** Customer-facing labels, served by GET /people/taxonomy so the UI has no hardcoded copy. */
export const DECISION_MAKER_TYPE_LABELS: Record<DecisionMakerType, string> = {
  FOUNDER_CEO: 'Founder / CEO / Owner',
  MANAGING_DIRECTOR: 'Managing Director',
  DIRECTOR_PARTNER: 'Director / Partner',
  GENERAL_MANAGER: 'General Manager',
  SALES_DECISION_MAKER: 'Sales Head',
  MARKETING_DECISION_MAKER: 'Marketing Head',
  BUSINESS_DEVELOPMENT_DECISION_MAKER: 'Business Development Head',
  TECHNOLOGY_DECISION_MAKER: 'Technology Head',
  OPERATIONS_DECISION_MAKER: 'Operations Head',
  FINANCE_DECISION_MAKER: 'Finance Head',
  HR_DECISION_MAKER: 'HR Head / Manager',
  PROCUREMENT_DECISION_MAKER: 'Procurement / Purchase',
};

export const DEPARTMENT_LABELS: Record<Department, string> = {
  EXECUTIVE: 'Executive',
  SALES: 'Sales',
  MARKETING: 'Marketing',
  BUSINESS_DEVELOPMENT: 'Business Development',
  TECHNOLOGY: 'Technology',
  OPERATIONS: 'Operations',
  FINANCE: 'Finance',
  HR: 'HR',
  PROCUREMENT: 'Procurement',
  LEGAL: 'Legal & Compliance',
  OTHER: 'Other',
  UNKNOWN: 'Unknown',
};

export const SENIORITY_LABELS: Record<SeniorityLevel, string> = {
  EXECUTIVE: 'Executive / Owner',
  DIRECTOR: 'Director',
  HEAD: 'Head / VP',
  MANAGER: 'Manager',
  STAFF: 'Staff',
  UNKNOWN: 'Unknown',
};

/**
 * Search-phrase synonyms for the customer search intent parser: free text such as
 * "Head of Procurement" or "sales director" resolves to a decision-maker type.
 */
export const SEARCH_ROLE_PHRASES: Array<{ type: DecisionMakerType; phrases: RegExp }> = [
  // Functional (specific) phrases first: the parser consumes matched text, so generic
  // "director" only matches what is left after "sales director" has been taken.
  { type: 'SALES_DECISION_MAKER', phrases: /(head of sales|sales (heads?|directors?|vps?)|vp sales|cro)/i },
  { type: 'MARKETING_DECISION_MAKER', phrases: /(head of marketing|marketing (heads?|directors?|vps?)|cmo)/i },
  {
    type: 'BUSINESS_DEVELOPMENT_DECISION_MAKER',
    phrases: /(head of business development|business development (heads?|directors?)|bd heads?)/i,
  },
  { type: 'TECHNOLOGY_DECISION_MAKER', phrases: /(ctos?|cios?|head of (it|technology|engineering)|it heads?)/i },
  { type: 'OPERATIONS_DECISION_MAKER', phrases: /(coos?|head of operations|operations (heads?|directors?))/i },
  { type: 'FINANCE_DECISION_MAKER', phrases: /(cfos?|head of finance|finance (heads?|directors?))/i },
  { type: 'HR_DECISION_MAKER', phrases: /(chros?|hr (heads?|managers?|directors?)|head of hr)/i },
  {
    type: 'PROCUREMENT_DECISION_MAKER',
    phrases: /(head of (procurement|purchase)|procurement (heads?|managers?)|purchase (heads?|managers?)|cpos?)/i,
  },
  { type: 'GENERAL_MANAGER', phrases: /general managers?/i },
  { type: 'MANAGING_DIRECTOR', phrases: /(managing directors?|mds?|chairman|executive directors?)/i },
  { type: 'FOUNDER_CEO', phrases: /(co-?founders?|founders?|owners?|proprietors?|ceos?|chief executive)/i },
  { type: 'DIRECTOR_PARTNER', phrases: /(partners?|directors?)/i },
];
