import type { DecisionMakerType, Department, SeniorityLevel } from '../../people.constants';
import type { ITaxonomy } from '../taxonomy.types';

/**
 * Role taxonomy "v1": the ruleset Orion used from the first People release. It is the exact behaviour of the pre-versioning
 * classifier, with a stable id on every rule.
 *
 * IMMUTABLE ONCE USED. Never edit a rule, pattern, order or id in this file. To change how titles are interpreted, add
 * `v2.ts`, register it in `taxonomies/index.ts` and (only then) move CURRENT_TAXONOMY_VERSION. A test pins the fingerprint of
 * this file's content, so an accidental edit fails the build.
 *
 * Patterns run against a lower-cased title in which punctuation has been replaced by spaces (see normalizeTitle).
 * Array order IS the evaluation order wherever a rule says "first match wins".
 */

const rank: Record<SeniorityLevel, number> = {
  EXECUTIVE: 5,
  DIRECTOR: 4,
  HEAD: 3,
  MANAGER: 2,
  STAFF: 1,
  UNKNOWN: 0,
};

const dm = (id: string, type: DecisionMakerType, pattern: RegExp) => ({ id, type, pattern });
const sen = (id: string, level: SeniorityLevel, pattern: RegExp) => ({ id, level, pattern });
const dep = (id: string, department: Department, patterns: RegExp[]) => ({ id, department, patterns });
const fn = (id: string, type: DecisionMakerType, minSeniority: SeniorityLevel) => ({ id, type, minSeniority });

const v1: ITaxonomy = {
  version: 'v1',
  seniorityRank: rank,

  titleAliases: [
    { id: 'ALIAS-COFOUNDER', pattern: /\bco[\s-]?founders?\b/g, replacement: 'cofounder' },
    { id: 'ALIAS-FOUNDER', pattern: /\bfounders?\b/g, replacement: 'founder' },
    { id: 'ALIAS-CEO', pattern: /\bchief executive officer\b/g, replacement: 'ceo' },
    { id: 'ALIAS-CTO', pattern: /\bchief technology officer\b/g, replacement: 'cto' },
    { id: 'ALIAS-CIO', pattern: /\bchief information officer\b/g, replacement: 'cio' },
    { id: 'ALIAS-COO', pattern: /\bchief operating officer\b/g, replacement: 'coo' },
    { id: 'ALIAS-CFO', pattern: /\bchief financial officer\b/g, replacement: 'cfo' },
    { id: 'ALIAS-CMO', pattern: /\bchief marketing officer\b/g, replacement: 'cmo' },
    { id: 'ALIAS-CRO', pattern: /\bchief revenue officer\b/g, replacement: 'cro' },
    { id: 'ALIAS-CHRO', pattern: /\bchief human resources? officer\b/g, replacement: 'chro' },
    { id: 'ALIAS-CPO', pattern: /\bchief procurement officer\b/g, replacement: 'cpo' },
    { id: 'ALIAS-MANAGING-DIRECTOR', pattern: /\bmanaging directors?\b/g, replacement: 'managing director' },
    { id: 'ALIAS-VP', pattern: /\bvice[\s-]president\b/g, replacement: 'vp' },
    { id: 'ALIAS-GENERAL-MANAGER', pattern: /\bgeneral managers?\b/g, replacement: 'general manager' },
    { id: 'ALIAS-HR', pattern: /\bhuman resources?\b/g, replacement: 'hr' },
    { id: 'ALIAS-PURCHASE', pattern: /\bpurchasing\b/g, replacement: 'purchase' },
    { id: 'ALIAS-BIZ-DEV', pattern: /\bbiz dev\b/g, replacement: 'business development' },
  ],

  /** C-suite abbreviations that imply BOTH a department and executive seniority. */
  executiveAbbreviations: [
    { id: 'DEP-ABBR-CEO', abbreviation: 'ceo', department: 'EXECUTIVE' },
    { id: 'DEP-ABBR-CTO', abbreviation: 'cto', department: 'TECHNOLOGY' },
    { id: 'DEP-ABBR-CIO', abbreviation: 'cio', department: 'TECHNOLOGY' },
    { id: 'DEP-ABBR-CISO', abbreviation: 'ciso', department: 'TECHNOLOGY' },
    { id: 'DEP-ABBR-COO', abbreviation: 'coo', department: 'OPERATIONS' },
    { id: 'DEP-ABBR-CFO', abbreviation: 'cfo', department: 'FINANCE' },
    { id: 'DEP-ABBR-CMO', abbreviation: 'cmo', department: 'MARKETING' },
    { id: 'DEP-ABBR-CRO', abbreviation: 'cro', department: 'SALES' },
    { id: 'DEP-ABBR-CHRO', abbreviation: 'chro', department: 'HR' },
    { id: 'DEP-ABBR-CPO', abbreviation: 'cpo', department: 'PROCUREMENT' },
  ],

  /** The earliest department keyword (or abbreviation) in the title wins. */
  departmentKeywords: [
    dep('DEP-KW-SALES', 'SALES', [/\bsales\b/, /\brevenue\b/, /\baccount executive\b/]),
    dep('DEP-KW-MARKETING', 'MARKETING', [/\bmarketing\b/, /\bbrand\b/, /\bcommunications?\b/]),
    dep('DEP-KW-BUSINESS-DEVELOPMENT', 'BUSINESS_DEVELOPMENT', [/\bbusiness development\b/, /\bbd\b/, /\bpartnerships?\b/, /\balliances?\b/]),
    dep('DEP-KW-TECHNOLOGY', 'TECHNOLOGY', [/\btechnology\b/, /\btechnical\b/, /\bit\b/, /\bengineering\b/, /\bsoftware\b/, /\bdigital\b/, /\bdata\b/]),
    dep('DEP-KW-OPERATIONS', 'OPERATIONS', [/\boperations?\b/, /\bops\b/, /\bsupply chain\b/, /\blogistics\b/, /\bproduction\b/, /\bmanufacturing\b/, /\bplant\b/]),
    dep('DEP-KW-FINANCE', 'FINANCE', [/\bfinance\b/, /\bfinancial\b/, /\baccounts?\b/, /\baccounting\b/, /\btreasury\b/]),
    dep('DEP-KW-HR', 'HR', [/\bhr\b/, /\btalent\b/, /\bpeople\b/, /\bpersonnel\b/]),
    dep('DEP-KW-PROCUREMENT', 'PROCUREMENT', [/\bprocurement\b/, /\bpurchase\b/, /\bsourcing\b/, /\bbuying\b/, /\bvendor\b/]),
    dep('DEP-KW-LEGAL', 'LEGAL', [/\blegal\b/, /\bcompliance\b/, /\bcompany secretary\b/]),
  ],

  /** Owner / top-of-company titles resolve to EXECUTIVE before any functional keyword is considered. */
  ownerLike: { id: 'DEP-EXEC-OWNER', pattern: /\b(cofounder|founder|owner|proprietor|promoter|ceo|managing director|chairman|chairperson|president|executive director|whole time director)\b/ },
  /** Used when no keyword matched: a senior generic title (GM / director / partner / chief) is an executive-department role. */
  executiveFallback: { id: 'DEP-EXEC-FALLBACK', pattern: /\b(general manager|gm|director|partner|chief)\b/, minSeniority: 'HEAD' },

  /** Seniority patterns in evaluation order (highest tier first); the first match wins. */
  seniority: [
    sen('SEN-EXEC-COFOUNDER', 'EXECUTIVE', /\bcofounder\b/),
    sen('SEN-EXEC-FOUNDER', 'EXECUTIVE', /\bfounder\b/),
    sen('SEN-EXEC-OWNER', 'EXECUTIVE', /(?<!\b(?:product|process|service|budget)\s)\bowner\b/),
    sen('SEN-EXEC-PROPRIETOR', 'EXECUTIVE', /\bproprietor\b/),
    sen('SEN-EXEC-PROMOTER', 'EXECUTIVE', /\bpromoter\b/),
    // "HR Business Partner" / "Channel Partner Manager" are staff roles, not firm partners.
    sen('SEN-EXEC-PARTNER', 'EXECUTIVE', /(?<!\b(?:channel|alliance|business|technology|solutions?|sales|strategic|hr|delivery)\s)\bpartner\b(?!\s+(?:manager|executive|success|account|relations|engineer|associate|lead|development))/),
    sen('SEN-EXEC-MANAGING-DIRECTOR', 'EXECUTIVE', /\bmanaging director\b/),
    sen('SEN-EXEC-EXECUTIVE-DIRECTOR', 'EXECUTIVE', /\bexecutive director\b/),
    sen('SEN-EXEC-WHOLE-TIME-DIRECTOR', 'EXECUTIVE', /\bwhole time director\b/),
    sen('SEN-EXEC-CHAIRMAN', 'EXECUTIVE', /\bchairman\b/),
    sen('SEN-EXEC-CHAIRPERSON', 'EXECUTIVE', /\bchairperson\b/),
    sen('SEN-EXEC-PRESIDENT', 'EXECUTIVE', /\bpresident\b/),
    sen('SEN-EXEC-CHIEF', 'EXECUTIVE', /\bchief\b/),
    sen('SEN-EXEC-C-LEVEL', 'EXECUTIVE', /\bc\s?level\b/),
    sen('SEN-EXEC-C-SUITE-ABBR', 'EXECUTIVE', /\b(ceo|cto|cio|ciso|coo|cfo|cmo|cro|chro|cpo)\b/),
    sen('SEN-EXEC-MD', 'EXECUTIVE', /\bmd\b/),
    sen('SEN-DIRECTOR', 'DIRECTOR', /\bdirector\b/),
    sen('SEN-HEAD-HEAD', 'HEAD', /\bhead\b/),
    sen('SEN-HEAD-VP', 'HEAD', /\bvp\b/),
    sen('SEN-HEAD-AVP', 'HEAD', /\bavp\b/),
    sen('SEN-HEAD-GENERAL-MANAGER', 'HEAD', /\bgeneral manager\b/),
    sen('SEN-HEAD-GM', 'HEAD', /\bgm\b/),
    sen('SEN-MANAGER-MANAGER', 'MANAGER', /\bmanager\b/),
    sen('SEN-MANAGER-SUPERINTENDENT', 'MANAGER', /\bsuperintendent\b/),
    sen('SEN-MANAGER-TEAM-LEAD', 'MANAGER', /\bteam lead\b/),
    sen('SEN-MANAGER-LEAD', 'MANAGER', /\blead\b/),
    sen('SEN-STAFF-EXECUTIVE', 'STAFF', /\bexecutive\b/),
    sen('SEN-STAFF-OFFICER', 'STAFF', /\bofficer\b/),
    sen('SEN-STAFF-ASSOCIATE', 'STAFF', /\bassociate\b/),
    sen('SEN-STAFF-ANALYST', 'STAFF', /\banalyst\b/),
    sen('SEN-STAFF-ENGINEER', 'STAFF', /\bengineer\b/),
    sen('SEN-STAFF-SPECIALIST', 'STAFF', /\bspecialist\b/),
    sen('SEN-STAFF-COORDINATOR', 'STAFF', /\bcoordinator\b/),
    sen('SEN-STAFF-ASSISTANT', 'STAFF', /\bassistant\b/),
    sen('SEN-STAFF-REPRESENTATIVE', 'STAFF', /\brepresentative\b/),
    sen('SEN-STAFF-CONSULTANT', 'STAFF', /\bconsultant\b/),
    sen('SEN-STAFF-INTERN', 'STAFF', /\bintern\b/),
    sen('SEN-STAFF-TRAINEE', 'STAFF', /\btrainee\b/),
  ],

  /** A junior qualifier caps a matched title at STAFF unless a senior override is also present. */
  juniorCap: { id: 'SEN-JUNIOR-CAP', qualifiers: /\b(assistant|asst|junior|trainee|intern)\b/, overrides: /\b(director|vp|avp|head)\b/ },

  /** Executive (non-functional) decision-maker rules, tried in order. */
  executiveRules: [
    dm('DM-EXEC-FOUNDER-CEO', 'FOUNDER_CEO', /\b(cofounder|founder|owner|proprietor|promoter|ceo)\b/),
    dm('DM-EXEC-MANAGING-DIRECTOR', 'MANAGING_DIRECTOR', /\b(managing director|md|executive director|whole time director|chairman|chairperson|president)\b/),
    dm('DM-EXEC-GENERAL-MANAGER', 'GENERAL_MANAGER', /\b(general manager|gm)\b/),
    dm('DM-EXEC-DIRECTOR-PARTNER', 'DIRECTOR_PARTNER', /\b(partner|director)\b/),
  ],

  /** Functional decision-maker rules: department + minimum seniority for the role to count as a decision-making role. */
  functionalRules: {
    SALES: fn('DM-FUNC-SALES', 'SALES_DECISION_MAKER', 'HEAD'),
    MARKETING: fn('DM-FUNC-MARKETING', 'MARKETING_DECISION_MAKER', 'HEAD'),
    BUSINESS_DEVELOPMENT: fn('DM-FUNC-BUSINESS-DEVELOPMENT', 'BUSINESS_DEVELOPMENT_DECISION_MAKER', 'HEAD'),
    TECHNOLOGY: fn('DM-FUNC-TECHNOLOGY', 'TECHNOLOGY_DECISION_MAKER', 'HEAD'),
    OPERATIONS: fn('DM-FUNC-OPERATIONS', 'OPERATIONS_DECISION_MAKER', 'HEAD'),
    FINANCE: fn('DM-FUNC-FINANCE', 'FINANCE_DECISION_MAKER', 'HEAD'),
    HR: fn('DM-FUNC-HR', 'HR_DECISION_MAKER', 'MANAGER'),
    PROCUREMENT: fn('DM-FUNC-PROCUREMENT', 'PROCUREMENT_DECISION_MAKER', 'MANAGER'),
  },

  /** Relationship rules in evaluation order. `unless` / `seniority` are extra guards, see the classifier. */
  relationshipRules: [
    { id: 'REL-FOUNDER', type: 'FOUNDER', pattern: /\b(cofounder|founder)\b/ },
    { id: 'REL-OWNER', type: 'OWNER', pattern: /\b(owner|proprietor)\b/ },
    { id: 'REL-PARTNER', type: 'PARTNER', pattern: /\bpartner\b/, requireSeniority: 'EXECUTIVE' },
    { id: 'REL-DIRECTOR', type: 'DIRECTOR', pattern: /\bdirector\b/, unless: /\bdirector of\b/, excludeSeniority: 'STAFF' },
    { id: 'REL-ADVISOR', type: 'ADVISOR', pattern: /\badvis(or|er)\b/ },
  ],
};

export const TAXONOMY_V1: ITaxonomy = v1;
