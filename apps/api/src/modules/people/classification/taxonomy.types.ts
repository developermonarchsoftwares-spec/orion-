import type { DecisionMakerType, Department, RelationshipType, SeniorityLevel } from '../people.constants';

/** One immutable, versioned ruleset. Every rule carries a stable id that is recorded with each classification it produces. */
export interface ITaxonomy {
  /** Opaque, human-assigned label such as "v1". Not a package version and not a code hash. */
  version: string;
  seniorityRank: Record<SeniorityLevel, number>;
  titleAliases: Array<{ id: string; pattern: RegExp; replacement: string }>;
  executiveAbbreviations: Array<{ id: string; abbreviation: string; department: Department }>;
  departmentKeywords: Array<{ id: string; department: Department; patterns: RegExp[] }>;
  ownerLike: { id: string; pattern: RegExp };
  executiveFallback: { id: string; pattern: RegExp; minSeniority: SeniorityLevel };
  seniority: Array<{ id: string; level: SeniorityLevel; pattern: RegExp }>;
  juniorCap: { id: string; qualifiers: RegExp; overrides: RegExp };
  executiveRules: Array<{ id: string; type: DecisionMakerType; pattern: RegExp }>;
  functionalRules: Partial<Record<Department, { id: string; type: DecisionMakerType; minSeniority: SeniorityLevel }>>;
  relationshipRules: Array<{
    id: string;
    type: RelationshipType;
    pattern: RegExp;
    /** The rule only applies when the seniority equals this. */
    requireSeniority?: SeniorityLevel;
    /** The rule is skipped when this pattern also matches. */
    unless?: RegExp;
    /** The rule is skipped for this seniority. */
    excludeSeniority?: SeniorityLevel;
  }>;
}

/**
 * How a result was reached, in deterministic categories (no invented percentages):
 * EXACT_RULE: matched on the title as written (no alias rewriting changed it);
 * NORMALIZED_RULE: matched after title aliases rewrote the text (e.g. "Chief Executive Officer" -> "ceo");
 * FALLBACK: the department / decision-maker came from a generic fallback rule, not a specific keyword;
 * UNCLASSIFIED: no seniority rule matched; seniority and department stay UNKNOWN.
 */
export type ClassificationStrength = 'EXACT_RULE' | 'NORMALIZED_RULE' | 'FALLBACK' | 'UNCLASSIFIED';

export interface IClassificationRuleTrace {
  /** Rule ids of the alias rewrites that changed the title, in the order they applied. */
  aliases: string[];
  seniority: string;
  department: string;
  decisionMaker: string;
  relationship: string;
}
