import { DECISION_MAKER_TYPE_LABELS } from './role-taxonomy.config';
import { currentTaxonomy } from './taxonomies';
import type { ClassificationStrength, IClassificationRuleTrace, ITaxonomy } from './taxonomy.types';
import type { DecisionMakerType, Department, RelationshipType, SeniorityLevel } from '../people.constants';

export interface IRoleClassification {
  /** Lower-cased, alias-expanded, punctuation-free title. Used as the dedupe key for a role. */
  normalizedTitle: string;
  seniorityLevel: SeniorityLevel;
  department: Department;
  /** null when the role is not a decision-making role. */
  decisionMakerType: DecisionMakerType | null;
  decisionMakerLabel: string | null;
  relationshipType: RelationshipType;
  /** The taxonomy version that produced this result. Results are only comparable within one version. */
  taxonomyVersion: string;
  /** The stable rule ids that decided each field. Explains the result without consulting current configuration. */
  ruleTrace: IClassificationRuleTrace;
  /** Compact single-string form of ruleTrace, e.g. "SEN-EXEC-FOUNDER|DEP-EXEC-OWNER|DM-EXEC-FOUNDER-CEO|REL-FOUNDER". */
  ruleId: string;
  strength: ClassificationStrength;
}

// Rule ids of the engine's own defaults (what applies when no taxonomy rule matched). They belong to the engine contract of
// each taxonomy version: changing one of these meanings requires a new taxonomy version.
const SEN_UNMATCHED = 'SEN-UNMATCHED';
const DEP_EMPTY = 'DEP-EMPTY';
const DEP_OTHER_DEFAULT = 'DEP-OTHER-DEFAULT';
const DEP_UNKNOWN_DEFAULT = 'DEP-UNKNOWN-DEFAULT';
const DM_NONE_SENIORITY = 'DM-NONE-SENIORITY';
const DM_NONE_NO_EXECUTIVE_RULE = 'DM-NONE-NO-EXECUTIVE-RULE';
const DM_NONE_BELOW_MINIMUM = 'DM-NONE-BELOW-MINIMUM';
const DM_NONE_NO_RULE = 'DM-NONE-NO-RULE';
const REL_EXECUTIVE = 'REL-EXECUTIVE';
const REL_EMPLOYEE = 'REL-EMPLOYEE';
const REL_OTHER = 'REL-OTHER';

function normalizeWithTrace(rawTitle: string | null | undefined, taxonomy: ITaxonomy): { normalized: string; aliases: string[] } {
  let t = (rawTitle ?? '').toLowerCase().replace(/&/g, ' and ');
  const aliases: string[] = [];
  for (const alias of taxonomy.titleAliases) {
    const next = t.replace(alias.pattern, alias.replacement);
    if (next !== t) aliases.push(alias.id);
    t = next;
  }
  const normalized = t
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { normalized, aliases };
}

export function normalizeTitle(rawTitle: string | null | undefined, taxonomy: ITaxonomy = currentTaxonomy()): string {
  return normalizeWithTrace(rawTitle, taxonomy).normalized;
}

function detectSeniority(normalized: string, taxonomy: ITaxonomy): { level: SeniorityLevel; ruleId: string } {
  const hit = taxonomy.seniority.find((r) => r.pattern.test(normalized));
  if (!hit) return { level: 'UNKNOWN', ruleId: SEN_UNMATCHED };
  const cap = taxonomy.juniorCap;
  if (cap.qualifiers.test(normalized) && !cap.overrides.test(normalized)) return { level: 'STAFF', ruleId: cap.id };
  return { level: hit.level, ruleId: hit.id };
}

function detectDepartment(
  normalized: string,
  seniority: SeniorityLevel,
  taxonomy: ITaxonomy,
): { department: Department; ruleId: string; fallback: boolean } {
  if (!normalized) return { department: 'UNKNOWN', ruleId: DEP_EMPTY, fallback: false };
  if (seniority === 'EXECUTIVE' && taxonomy.ownerLike.pattern.test(normalized)) {
    return { department: 'EXECUTIVE', ruleId: taxonomy.ownerLike.id, fallback: false };
  }

  // Earliest functional keyword or C-suite abbreviation wins; on a tie the rule listed first wins.
  const best: { department: Department | null; ruleId: string; index: number } = { department: null, ruleId: '', index: Infinity };
  const consider = (department: Department, ruleId: string, index: number) => {
    if (index >= 0 && index < best.index) {
      best.department = department;
      best.ruleId = ruleId;
      best.index = index;
    }
  };
  for (const { id, department, patterns } of taxonomy.departmentKeywords) {
    for (const p of patterns) consider(department, id, normalized.search(p));
  }
  for (const { id, abbreviation, department } of taxonomy.executiveAbbreviations) {
    consider(department, id, normalized.search(new RegExp(`\\b${abbreviation}\\b`)));
  }
  if (best.department) return { department: best.department, ruleId: best.ruleId, fallback: false };

  const fb = taxonomy.executiveFallback;
  if (fb.pattern.test(normalized) && taxonomy.seniorityRank[seniority] >= taxonomy.seniorityRank[fb.minSeniority]) {
    return { department: 'EXECUTIVE', ruleId: fb.id, fallback: true };
  }
  return seniority === 'UNKNOWN'
    ? { department: 'UNKNOWN', ruleId: DEP_UNKNOWN_DEFAULT, fallback: false }
    : { department: 'OTHER', ruleId: DEP_OTHER_DEFAULT, fallback: true };
}

function detectDecisionMakerType(
  normalized: string,
  department: Department,
  seniority: SeniorityLevel,
  taxonomy: ITaxonomy,
): { type: DecisionMakerType | null; ruleId: string } {
  if (seniority === 'STAFF' || seniority === 'UNKNOWN') return { type: null, ruleId: DM_NONE_SENIORITY };

  if (department === 'EXECUTIVE') {
    const rule = taxonomy.executiveRules.find((r) => r.pattern.test(normalized));
    return rule ? { type: rule.type, ruleId: rule.id } : { type: null, ruleId: DM_NONE_NO_EXECUTIVE_RULE };
  }
  const rule = taxonomy.functionalRules[department];
  if (!rule) return { type: null, ruleId: DM_NONE_NO_RULE };
  if (taxonomy.seniorityRank[seniority] >= taxonomy.seniorityRank[rule.minSeniority]) return { type: rule.type, ruleId: rule.id };
  return { type: null, ruleId: DM_NONE_BELOW_MINIMUM };
}

function detectRelationship(normalized: string, seniority: SeniorityLevel, taxonomy: ITaxonomy): { type: RelationshipType; ruleId: string } {
  for (const r of taxonomy.relationshipRules) {
    if (!r.pattern.test(normalized)) continue;
    if (r.requireSeniority && seniority !== r.requireSeniority) continue;
    if (r.unless?.test(normalized)) continue;
    if (r.excludeSeniority && seniority === r.excludeSeniority) continue;
    return { type: r.type, ruleId: r.id };
  }
  if (seniority === 'EXECUTIVE') return { type: 'EXECUTIVE', ruleId: REL_EXECUTIVE };
  return normalized ? { type: 'EMPLOYEE', ruleId: REL_EMPLOYEE } : { type: 'OTHER', ruleId: REL_OTHER };
}

export function inferRelationshipType(normalized: string, seniority: SeniorityLevel, taxonomy: ITaxonomy = currentTaxonomy()): RelationshipType {
  return detectRelationship(normalized, seniority, taxonomy).type;
}

/**
 * Classifies a raw job title with ONE explicit taxonomy version. Pure and deterministic: the same title and the same
 * taxonomy always give the same result, independent of time, database state, ingestion order or source. It publishes,
 * verifies, suppresses and stores nothing; callers persist the result together with `taxonomyVersion` and `ruleTrace`.
 */
export function classifyWithTaxonomy(rawTitle: string | null | undefined, taxonomy: ITaxonomy): IRoleClassification {
  const { normalized, aliases } = normalizeWithTrace(rawTitle, taxonomy);
  const sen = detectSeniority(normalized, taxonomy);
  const dep = detectDepartment(normalized, sen.level, taxonomy);
  const dmr = detectDecisionMakerType(normalized, dep.department, sen.level, taxonomy);
  const rel = detectRelationship(normalized, sen.level, taxonomy);

  const ruleTrace: IClassificationRuleTrace = {
    aliases,
    seniority: sen.ruleId,
    department: dep.ruleId,
    decisionMaker: dmr.ruleId,
    relationship: rel.ruleId,
  };
  const strength: ClassificationStrength =
    sen.level === 'UNKNOWN' ? 'UNCLASSIFIED' : dep.fallback ? 'FALLBACK' : aliases.length > 0 ? 'NORMALIZED_RULE' : 'EXACT_RULE';

  return {
    normalizedTitle: normalized,
    seniorityLevel: sen.level,
    department: dep.department,
    decisionMakerType: dmr.type,
    decisionMakerLabel: dmr.type ? DECISION_MAKER_TYPE_LABELS[dmr.type] : null,
    relationshipType: rel.type,
    taxonomyVersion: taxonomy.version,
    ruleTrace,
    ruleId: [sen.ruleId, dep.ruleId, dmr.ruleId, rel.ruleId].join('|'),
    strength,
  };
}

/** Classifies with the CURRENT taxonomy version (what new ingestion uses). */
export function classifyRole(rawTitle: string | null | undefined): IRoleClassification {
  return classifyWithTaxonomy(rawTitle, currentTaxonomy());
}
