/**
 * URL state of the People Review screen (internal reviewers only). Pure: it only converts between a query string and the screen's
 * navigation state; it never calls the API and never invents data.
 *
 * The admin console is one client page (/admin/monarch) whose section is React state, so the screen's own state lives in that page's
 * query string: `?section=people_review&pr=roles&status=APPROVED&q=anil&page=2&role=<role id>`.
 *   - Only values that differ from the defaults are written, and only the ACTIVE sub-tab's filters (switching sub-tab resets filters, as before).
 *   - Every value read from a URL is validated against a whitelist (enumerations), a UUID check (role) or a bounded number (page);
 *     anything else falls back to the default, so a hand-edited URL can never put the screen in an impossible state.
 *   - `role` / `qitem` are the existing role id and quarantine item id and nothing else; each is only ever sent to its existing detail API
 *     (roles/:id, quarantine/:id), which does the authorization. Only one drawer is open at a time: if both are present the role wins.
 */

export const REVIEW_SECTION = 'people_review';
export const REVIEW_TABS = ['triage', 'roles', 'quarantine'] as const;
export type ReviewTab = (typeof REVIEW_TABS)[number];

export const ROLE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'QUARANTINED', 'ALL'] as const;
export const ROLE_SORTS = ['created_desc', 'created_asc', 'updated_desc', 'confidence_desc', 'confidence_asc'] as const;
export const DECISION_MAKER_FILTERS = ['NONE', 'FOUNDER_CEO', 'MANAGING_DIRECTOR', 'DIRECTOR_PARTNER', 'GENERAL_MANAGER', 'SALES_DECISION_MAKER', 'MARKETING_DECISION_MAKER', 'BUSINESS_DEVELOPMENT_DECISION_MAKER', 'TECHNOLOGY_DECISION_MAKER', 'OPERATIONS_DECISION_MAKER', 'FINANCE_DECISION_MAKER', 'HR_DECISION_MAKER', 'PROCUREMENT_DECISION_MAKER'] as const;
export const VERIFICATION_FILTERS = ['UNVERIFIED', 'PARTIALLY_VERIFIED', 'VERIFIED', 'STALE', 'CONFLICTED'] as const;
export const SOURCE_FILTERS = ['GOVERNMENT_REGISTRY', 'WEB_SCRAPING', 'MANUAL_IMPORT', 'PARTNER_FEED', 'API_INTEGRATION', 'USER_SUBMISSION'] as const;
export const TRIAGE_CATEGORIES = ['QUARANTINE', 'CONFLICT', 'VERIFICATION', 'CLASSIFICATION', 'IDENTITY', 'CONTACT', 'SUPPRESSION'] as const;
export const TRIAGE_PRIORITIES = ['CRITICAL', 'HIGH', 'NORMAL', 'LOW'] as const;
export const TRIAGE_STATUSES = ['PENDING', 'OPEN', 'APPROVED', 'QUARANTINED', 'PUBLISHED', 'UNPUBLISHED'] as const;
export const QUARANTINE_STATUSES = ['PENDING', 'RESOLVED', 'DISCARDED', 'ALL'] as const;
export const QUARANTINE_CODES = ['AMBIGUOUS_IDENTITY', 'PERSON_SUPPRESSED', 'BUSINESS_NOT_FOUND', 'AMBIGUOUS_BUSINESS', 'MISSING_TITLE', 'NAME_INCOMPLETE', 'MISSING_NAME', 'INVALID_SOURCE_TYPE', 'REVIEWER_QUARANTINE'] as const;

export interface IRolesFilters {
  status: string; company: string; q: string; decisionMakerType: string; verification: string; source: string;
  minConfidence: string; hasEvidence: string; sort: string; page: string;
}
export interface ITriageFilters { category: string; priority: string; status: string; q: string; detectedFrom: string; page: string }
export interface IQuarantineFilters { status: string; code: string; page: string }

export interface IReviewUiState {
  tab: ReviewTab;
  roles: IRolesFilters;
  triage: ITriageFilters;
  quarantine: IQuarantineFilters;
  /** The role whose dossier is open (any sub-tab), or null. */
  role: string | null;
  /** The quarantine item whose drawer is open (from Quarantine or Triage), or null. Never set together with `role`. */
  quarantineItem: string | null;
}

export const DEFAULT_ROLES_FILTERS: IRolesFilters = { status: 'PENDING', company: '', q: '', decisionMakerType: '', verification: '', source: '', minConfidence: '', hasEvidence: '', sort: 'created_desc', page: '1' };
export const DEFAULT_TRIAGE_FILTERS: ITriageFilters = { category: '', priority: '', status: '', q: '', detectedFrom: '', page: '1' };
export const DEFAULT_QUARANTINE_FILTERS: IQuarantineFilters = { status: 'PENDING', code: '', page: '1' };
export const DEFAULT_REVIEW_STATE: IReviewUiState = { tab: 'triage', roles: DEFAULT_ROLES_FILTERS, triage: DEFAULT_TRIAGE_FILTERS, quarantine: DEFAULT_QUARANTINE_FILTERS, role: null, quarantineItem: null };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isRoleId = (v: string | null | undefined): v is string => !!v && UUID_RE.test(v);

const MAX_TEXT = 100;
const MAX_PAGE = 100_000;
/** Query keys this screen owns (everything else in the query string is left alone). */
const OWNED_KEYS = ['section', 'pr', 'role', 'qitem', 'status', 'company', 'q', 'dm', 'verification', 'source', 'minConfidence', 'hasEvidence', 'sort', 'page', 'category', 'priority', 'since', 'code'];

const oneOf = (v: string | null, allowed: readonly string[], fallback: string): string => (v !== null && allowed.includes(v) ? v : fallback);
const text = (v: string | null): string => (v ?? '').trim().slice(0, MAX_TEXT);
const page = (v: string | null): string => {
  const n = Number(v);
  return v !== null && /^\d+$/.test(v) && Number.isSafeInteger(n) && n >= 1 && n <= MAX_PAGE ? String(n) : '1';
};
const confidence = (v: string | null): string => {
  const n = Number(v);
  return v !== null && /^\d+$/.test(v) && n >= 0 && n <= 100 ? String(n) : '';
};
const isoDay = (v: string | null): string => (v !== null && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(v).getTime()) ? v : '');

export interface IParsedReviewUrl {
  state: IReviewUiState;
  /** The URL carried a `role` that is not a valid role id: it was ignored (never sent to the API). */
  invalidRole: boolean;
  /** Same for `qitem`. */
  invalidQuarantine: boolean;
}

/** True when the query string asks for the People Review section. */
export const isReviewUrl = (search: string): boolean => new URLSearchParams(search).get('section') === REVIEW_SECTION;

export function parseReviewUrl(search: string): IParsedReviewUrl {
  const p = new URLSearchParams(search);
  const tab = oneOf(p.get('pr'), REVIEW_TABS, 'triage') as ReviewTab;
  const rawRole = p.get('role');
  const rawItem = p.get('qitem');
  const roleId = isRoleId(rawRole) ? rawRole.toLowerCase() : null;
  const state: IReviewUiState = {
    tab,
    roles: { ...DEFAULT_ROLES_FILTERS },
    triage: { ...DEFAULT_TRIAGE_FILTERS },
    quarantine: { ...DEFAULT_QUARANTINE_FILTERS },
    role: roleId,
    quarantineItem: !roleId && isRoleId(rawItem) ? rawItem.toLowerCase() : null,
  };
  // only the active sub-tab's filters are read: a stray filter of another sub-tab in the URL is ignored
  if (tab === 'roles') {
    state.roles = {
      status: oneOf(p.get('status'), ROLE_STATUSES, DEFAULT_ROLES_FILTERS.status),
      company: text(p.get('company')),
      q: text(p.get('q')),
      decisionMakerType: oneOf(p.get('dm'), DECISION_MAKER_FILTERS, ''),
      verification: oneOf(p.get('verification'), VERIFICATION_FILTERS, ''),
      source: oneOf(p.get('source'), SOURCE_FILTERS, ''),
      minConfidence: confidence(p.get('minConfidence')),
      hasEvidence: oneOf(p.get('hasEvidence'), ['true', 'false'], ''),
      sort: oneOf(p.get('sort'), ROLE_SORTS, DEFAULT_ROLES_FILTERS.sort),
      page: page(p.get('page')),
    };
  } else if (tab === 'triage') {
    state.triage = {
      category: oneOf(p.get('category'), TRIAGE_CATEGORIES, ''),
      priority: oneOf(p.get('priority'), TRIAGE_PRIORITIES, ''),
      status: oneOf(p.get('status'), TRIAGE_STATUSES, ''),
      q: text(p.get('q')),
      detectedFrom: isoDay(p.get('since')),
      page: page(p.get('page')),
    };
  } else {
    state.quarantine = {
      status: oneOf(p.get('status'), QUARANTINE_STATUSES, DEFAULT_QUARANTINE_FILTERS.status),
      code: oneOf(p.get('code'), QUARANTINE_CODES, ''),
      page: page(p.get('page')),
    };
  }
  return {
    state,
    invalidRole: rawRole !== null && rawRole !== '' && !isRoleId(rawRole),
    invalidQuarantine: rawItem !== null && rawItem !== '' && !isRoleId(rawItem),
  };
}

/** The screen's own query parameters for a state: defaults omitted, active sub-tab only, always `section`. */
export function reviewParams(state: IReviewUiState): Array<[string, string]> {
  const out: Array<[string, string]> = [['section', REVIEW_SECTION]];
  if (state.tab !== 'triage') out.push(['pr', state.tab]);
  const add = (key: string, value: string, def = '') => { if (value !== def) out.push([key, value]); };
  if (state.tab === 'roles') {
    const r = state.roles;
    add('status', r.status, DEFAULT_ROLES_FILTERS.status);
    add('company', r.company);
    add('q', r.q);
    add('dm', r.decisionMakerType);
    add('verification', r.verification);
    add('source', r.source);
    add('minConfidence', r.minConfidence);
    add('hasEvidence', r.hasEvidence);
    add('sort', r.sort, DEFAULT_ROLES_FILTERS.sort);
    add('page', r.page, '1');
  } else if (state.tab === 'triage') {
    const t = state.triage;
    add('category', t.category);
    add('priority', t.priority);
    add('status', t.status);
    add('q', t.q);
    add('since', t.detectedFrom);
    add('page', t.page, '1');
  } else {
    const c = state.quarantine;
    add('status', c.status, DEFAULT_QUARANTINE_FILTERS.status);
    add('code', c.code);
    add('page', c.page, '1');
  }
  if (state.role) out.push(['role', state.role]);
  else if (state.quarantineItem) out.push(['qitem', state.quarantineItem]);
  return out;
}

/** The full query string ("?..." or "") with this screen's parameters set for `state` and any foreign parameter left untouched. */
export function buildReviewSearch(state: IReviewUiState, currentSearch = ''): string {
  const p = new URLSearchParams(currentSearch);
  for (const k of OWNED_KEYS) p.delete(k);
  for (const [k, v] of reviewParams(state)) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** The query string with every parameter of this screen removed (used when the reviewer leaves the section). */
export function clearReviewSearch(currentSearch = ''): string {
  const p = new URLSearchParams(currentSearch);
  for (const k of OWNED_KEYS) p.delete(k);
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** History behaviour: opening, switching and closing a drawer (role dossier or quarantine item) and switching sub-tab are navigation (push); filter, search and page edits replace. */
export type NavigationMode = 'push' | 'replace';
export function navigationMode(prev: IReviewUiState, next: IReviewUiState): NavigationMode {
  return prev.role !== next.role || prev.quarantineItem !== next.quarantineItem || prev.tab !== next.tab ? 'push' : 'replace';
}

/** Page filters of the active sub-tab changed to a page beyond the last one (e.g. a stale link): the last page that exists. */
export const clampPage = (current: string, totalPages: number): string => (totalPages >= 1 && Number(current) > totalPages ? String(totalPages) : current);
