'use client';
/* eslint-disable @typescript-eslint/no-explicit-any -- internal admin view over loosely-typed review payloads */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CircleAlert, Loader2, ShieldCheck, X } from 'lucide-react';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { buildProvenanceView, type IProvenance } from '@/lib/people-provenance';
import { attributionBadge, type AttributionTone, type IContactAttributionInfo } from '@/lib/people-review-contact-attribution';
import { FORBIDDEN_MESSAGE, classifyLoadFailure, drawerPhase, drawerTitle, isActivateKey, isCloseKey, nextFocusTarget, type IDrawerFailure } from '@/lib/people-review-drawer';
import {
  DEFAULT_QUARANTINE_FILTERS, DEFAULT_REVIEW_STATE, DEFAULT_ROLES_FILTERS, DEFAULT_TRIAGE_FILTERS,
  buildReviewSearch, clampPage, clearReviewSearch, isRoleId, navigationMode, parseReviewUrl,
  type IQuarantineFilters, type IReviewUiState, type IRolesFilters, type ITriageFilters, type ReviewTab,
} from '@/lib/people-review-url';

/**
 * Internal People review. Talks only to /internal/people-review/* (internal roles only; the API
 * enforces this, the UI merely hides nothing sensitive from the people who may see it).
 */

interface Pagination { page: number; limit: number; totalItems: number; totalPages: number }
interface QueueItem {
  id: string; personId: string; fullName: string; companyName: string; jobTitle: string;
  decisionMakerType: string | null; decisionMakerLabel: string | null; reviewStatus: string; isPublished: boolean;
  verificationStatus: string; confidence: { score: number; level: string };
  evidenceCount: number; verifiedEvidenceCount: number; sourceTypes: string[]; contactCount: number; publishedContactCount: number;
  createdAt: string; updatedAt: string;
}
interface Detail {
  role: Record<string, any>; quality: Record<string, any>; person: Record<string, any>; company: Record<string, any>;
  contacts: Array<{ id: string; type: string; value: string; isPublished: boolean; verificationStatus: string; evidenceCount: number; canPublish: boolean; attribution?: IContactAttributionInfo }>;
  evidence: Array<Record<string, any>>; otherRoles: Array<Record<string, any>>; verification: Claim[]; provenance?: IProvenance;
  readiness: { canApprove: boolean; blockers: string[] }; auditTrail: Array<Record<string, any>>;
}
interface Claim {
  claim: string; label: string; contactId: string | null; currentValue: string | null; displayValue: string | null;
  state: 'UNVERIFIED' | 'VERIFIED' | 'NEEDS_REVIEW' | 'STALE' | 'DISPUTED'; previousValue: string | null;
  verifiedBy: string | null; verifiedAt: string | null; note: string | null;
  basis: { evidenceType: string; sourceType: string; reference: string | null } | null;
  acceptedEvidenceTypes: string[]; eligibleEvidence: Array<{ id: string; evidenceType: string; sourceType: string; reference: string | null }>;
}
interface QItem { id: string; status: string; kind: string; personName: string | null; jobTitle: string | null; batchRef: string | null; reasons: Array<{ code: string; message: string }>; createdAt: string }

import { getAdminAccessToken, ADMIN_SESSION_EXPIRED_EVENT } from '@/lib/admin-fetch';

const BASE = '/internal/people-review';
const VBASE = '/internal/people-verification';

async function call(method: string, path: string, body?: unknown, base: string = BASE): Promise<any> {
  const token = (typeof window !== 'undefined' ? localStorage.getItem('orion_admin_token') : null) || apiClient.getAccessToken();
  const res = await fetch(`${apiClient.getBaseUrl()}${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(ADMIN_SESSION_EXPIRED_EVENT));
    }
    const msg = Array.isArray(json?.message) ? json.message.join(', ') : json?.message || `Request failed (${res.status})`;
    throw Object.assign(new Error(res.status === 403 ? FORBIDDEN_MESSAGE : msg), { status: res.status });
  }
  return json;
}
const qs = (o: Record<string, string | undefined>) => {
  const p = new URLSearchParams();
  Object.entries(o).forEach(([k, v]) => v && p.set(k, v));
  return p.toString();
};

const pill = 'inline-flex items-center rounded-full border border-zinc-200 dark:border-zinc-700 px-2 py-0.5 text-[11px] font-medium';
const input = 'h-8 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 text-xs';
const btn = 'inline-flex items-center justify-center rounded-lg border border-zinc-200 dark:border-zinc-800 px-3 h-8 text-xs font-semibold hover:bg-zinc-50 dark:hover:bg-zinc-900 disabled:opacity-50 cursor-pointer';
const btnPrimary = 'inline-flex items-center justify-center rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-3 h-8 text-xs font-semibold disabled:opacity-50 cursor-pointer';

export function PeopleReviewView() {
  // The screen's navigation state (sub-tab, filters, page, open dossier) lives in the URL (see lib/people-review-url.ts). The first
  // render reads it, so a deep link or a reload opens the same queue and dossier with a single set of requests.
  const [ui, setUi] = useState<IReviewUiState>(() => (typeof window === 'undefined' ? DEFAULT_REVIEW_STATE : parseReviewUrl(window.location.search).state));
  const uiRef = useRef(ui);
  const [reload, setReload] = useState(0);
  const [stats, setStats] = useState<{ roles: Record<string, number>; quarantine: Record<string, number> } | null>(null);
  const refreshStats = useCallback(() => call('GET', '/stats').then((r) => setStats(r.data)).catch(() => undefined), []);
  useEffect(() => {
    refreshStats();
  }, [refreshStats]);

  /** Every navigation goes through here so state, URL and browser history are one thing. */
  const navigate = useCallback((update: (s: IReviewUiState) => IReviewUiState) => {
    const prev = uiRef.current;
    const next = update(prev);
    if (next === prev) return;
    const url = `${window.location.pathname}${buildReviewSearch(next, window.location.search)}`;
    if (url !== `${window.location.pathname}${window.location.search}`) {
      window.history[navigationMode(prev, next) === 'push' ? 'pushState' : 'replaceState'](null, '', url);
    }
    uiRef.current = next;
    setUi(next);
  }, []);

  useEffect(() => {
    const here = `${window.location.pathname}`;
    const parsedAtMount = parseReviewUrl(window.location.search);
    if (parsedAtMount.invalidRole) toast.error('That role link is not valid.');
    else if (parsedAtMount.invalidQuarantine) toast.error('That quarantine link is not valid.');
    // mark the current history entry as this section (no new entry) and normalise whatever the URL carried
    window.history.replaceState(null, '', `${here}${buildReviewSearch(uiRef.current, window.location.search)}`);
    const onPop = () => {
      const next = parseReviewUrl(window.location.search).state;
      uiRef.current = next;
      setUi(next);
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      // leaving the section resets it (as before): its parameters leave the URL
      window.history.replaceState(null, '', `${here}${clearReviewSearch(window.location.search)}`);
    };
  }, []);

  const changed = useCallback(() => { setReload((n) => n + 1); refreshStats(); }, [refreshStats]);
  const setTab = (tab: ReviewTab) => navigate((s) => (s.tab === tab ? s : { ...s, tab, roles: DEFAULT_ROLES_FILTERS, triage: DEFAULT_TRIAGE_FILTERS, quarantine: DEFAULT_QUARANTINE_FILTERS }));
  const patchRoles = (patch: Partial<IRolesFilters>) => navigate((s) => ({ ...s, roles: { ...s.roles, ...patch } }));
  const patchTriage = (patch: Partial<ITriageFilters>) => navigate((s) => ({ ...s, triage: { ...s.triage, ...patch } }));
  const patchQuarantine = (patch: Partial<IQuarantineFilters>) => navigate((s) => ({ ...s, quarantine: { ...s.quarantine, ...patch } }));
  const openRole = (id: string) => {
    if (!isRoleId(id)) return void toast.error('That role link is not valid.');
    navigate((s) => (s.role === id.toLowerCase() ? s : { ...s, role: id.toLowerCase(), quarantineItem: null }));
  };
  const openQuarantine = (id: string) => {
    if (!isRoleId(id)) return void toast.error('That quarantine link is not valid.');
    navigate((s) => (s.quarantineItem === id.toLowerCase() && !s.role ? s : { ...s, quarantineItem: id.toLowerCase(), role: null }));
  };
  /** One drawer at a time: closing is navigation, like opening. */
  const closeDrawer = () => navigate((s) => (s.role === null && s.quarantineItem === null ? s : { ...s, role: null, quarantineItem: null }));
  const tab = ui.tab;

  return (
    <div className="space-y-4 p-1">
      <div className="flex flex-wrap items-center gap-3">
        {(['triage', 'roles', 'quarantine'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cn(btn, tab === t && 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900')}>
            {t === 'triage' ? 'Triage' : t === 'roles' ? `Roles to review${stats ? ` (${stats.roles.PENDING ?? 0})` : ''}` : `Quarantine${stats ? ` (${stats.quarantine.PENDING ?? 0})` : ''}`}
          </button>
        ))}
        <span className="text-xs text-zinc-500 flex items-center gap-1">
          <ShieldCheck className="w-3.5 h-3.5" /> Nothing here is visible to customers until a role is approved. Approving a role never publishes the person&apos;s other roles.
        </span>
      </div>
      {tab === 'triage' ? <TriageList f={ui.triage} onFilters={patchTriage} reload={reload} onOpenRole={openRole} onOpenQuarantine={openQuarantine} /> : tab === 'roles' ? <RolesQueue f={ui.roles} onFilters={patchRoles} reload={reload} onOpenRole={openRole} /> : <QuarantineQueue f={ui.quarantine} onFilters={patchQuarantine} reload={reload} onOpen={openQuarantine} />}
      {/* key = role id: opening another role (or Back / Forward) starts from a clean drawer, never showing the previous role's data */}
      {ui.role ? <RoleDrawer key={ui.role} id={ui.role} onClose={closeDrawer} onChanged={changed} />
        : ui.quarantineItem ? <QuarantineDrawer key={ui.quarantineItem} id={ui.quarantineItem} onClose={closeDrawer} onChanged={changed} /> : null}
    </div>
  );
}

/** A queue row opens its item on click, and on Enter / Space when focused (rows are keyboard-reachable). */
const rowProps = (open: () => void) => ({
  tabIndex: 0,
  onClick: open,
  onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.target === e.currentTarget && isActivateKey(e.key)) {
      e.preventDefault();
      open();
    }
  },
});
const ROW_CLASS = 'border-t border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 focus-visible:bg-zinc-100 dark:focus-visible:bg-zinc-800 focus-visible:outline-none cursor-pointer';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal drawer behaviour (same Escape convention as the other admin drawers): Escape closes, focus moves into the drawer on open,
 * Tab stays inside it, and focus returns to whatever opened it when it closes (nothing to restore for a deep link).
 */
function useDrawerA11y(ref: React.RefObject<HTMLDivElement | null>, onClose: () => void) {
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const el = ref.current;
    el?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (isCloseKey(e.key, e.defaultPrevented)) {
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key === 'Tab' && el) {
        const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)];
        const target = nextFocusTarget(items.length, items.indexOf(document.activeElement as HTMLElement), e.shiftKey);
        if (target !== null) {
          e.preventDefault();
          items[target]?.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (opener && opener !== document.body && document.contains(opener)) opener.focus();
    };
  }, [ref]);
}

/** A stale or hand-edited page number beyond the last page falls back to the last page that exists (a replace, not a new history entry). */
function useClampPage(pagination: Pagination | null, page: string, setPage: (p: string) => void) {
  useEffect(() => {
    if (!pagination) return;
    const clamped = clampPage(page, pagination.totalPages);
    if (clamped !== page) setPage(clamped);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination, page]);
}

function useList<T>(path: string, params: Record<string, string | undefined>, reload: number) {
  const [rows, setRows] = useState<T[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify(params) + reload;
  useEffect(() => {
    let cancelled = false;
    call('GET', `${path}?${qs(params)}`)
      .then((r) => {
        if (cancelled) return;
        setRows(r.data);
        setPagination(r.pagination);
        setError(null);
      })
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, key]);
  return { rows, pagination, loading, error };
}

interface TriageItem {
  id: string; category: string; reasonCode: string; priority: 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW'; status: string;
  refType: string; refId: string; personId: string | null; personName: string | null; businessId: string | null; companyName: string | null;
  detectedAt: string; link: { workflow: 'QUARANTINE_REVIEW' | 'ROLE_REVIEW' | 'VERIFICATION_REVIEW'; path: string };
}
const PRIORITY_STYLE: Record<string, string> = { CRITICAL: 'text-red-700 border-red-300', HIGH: 'text-amber-700 border-amber-300', NORMAL: '', LOW: 'text-zinc-500' };

/**
 * Read-only triage over existing quality signals. It has no state of its own: an item disappears when the underlying record
 * changes. Opening an item opens the EXISTING quarantine / role review drawer, where every action (and its permission) lives.
 */
function TriageList({ f, onFilters, reload, onOpenRole, onOpenQuarantine }: { f: ITriageFilters; onFilters: (patch: Partial<ITriageFilters>) => void; reload: number; onOpenRole: (id: string) => void; onOpenQuarantine: (id: string) => void }) {
  const { rows, pagination, loading, error } = useList<TriageItem>('/triage', { ...f, detectedFrom: f.detectedFrom ? new Date(f.detectedFrom).toISOString() : undefined, limit: '25' }, reload);
  const set = (k: keyof ITriageFilters, v: string) => onFilters({ [k]: v, page: k === 'page' ? v : '1' });
  useClampPage(pagination, f.page, (p) => onFilters({ page: p }));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <select className={input} value={f.category} onChange={(e) => set('category', e.target.value)} aria-label="Category">
          <option value="">Any category</option>
          {['QUARANTINE', 'CONFLICT', 'VERIFICATION', 'CLASSIFICATION', 'IDENTITY', 'CONTACT', 'SUPPRESSION'].map((c) => <option key={c}>{c}</option>)}
        </select>
        <select className={input} value={f.priority} onChange={(e) => set('priority', e.target.value)} aria-label="Priority">
          <option value="">Any priority</option>
          {['CRITICAL', 'HIGH', 'NORMAL', 'LOW'].map((c) => <option key={c}>{c}</option>)}
        </select>
        <select className={input} value={f.status} onChange={(e) => set('status', e.target.value)} aria-label="Status">
          <option value="">Any status</option>
          {['PENDING', 'OPEN', 'APPROVED', 'QUARANTINED', 'PUBLISHED', 'UNPUBLISHED'].map((c) => <option key={c}>{c}</option>)}
        </select>
        <input className={input} placeholder="Person or company" value={f.q} onChange={(e) => set('q', e.target.value)} />
        <label className="text-xs text-zinc-500 flex items-center gap-1">Detected since <input type="date" className={input} value={f.detectedFrom} onChange={(e) => set('detectedFrom', e.target.value)} /></label>
      </div>
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : error ? <p className="text-xs text-red-600">{error}</p> : rows.length === 0 ? <p className="py-8 text-center text-xs text-zinc-500">Nothing needs review.</p> : (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-xs">
            <thead className="bg-zinc-50 dark:bg-zinc-900 text-left text-zinc-500"><tr>{['Priority', 'Category', 'Why', 'Person', 'Company', 'State', 'Detected'].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} {...rowProps(() => (r.link.workflow === 'QUARANTINE_REVIEW' ? onOpenQuarantine(r.refId) : onOpenRole(r.link.path.split('/').pop() as string)))} className={ROW_CLASS}>
                  <td className="px-3 py-2"><span className={cn(pill, PRIORITY_STYLE[r.priority])}>{r.priority}</span></td>
                  <td className="px-3 py-2">{r.category}</td>
                  <td className="px-3 py-2">{r.reasonCode}</td>
                  <td className="px-3 py-2 font-semibold">{r.personName ?? '-'}</td>
                  <td className="px-3 py-2">{r.companyName ?? '-'}</td>
                  <td className="px-3 py-2"><span className={pill}>{r.status}</span></td>
                  <td className="px-3 py-2">{new Date(r.detectedAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span>Page {pagination.page} of {pagination.totalPages} · {pagination.totalItems} items</span>
          <div className="flex gap-2">
            <button className={btn} disabled={pagination.page <= 1} onClick={() => set('page', String(pagination.page - 1))}>Previous</button>
            <button className={btn} disabled={pagination.page >= pagination.totalPages} onClick={() => set('page', String(pagination.page + 1))}>Next</button>
          </div>
        </div>
      )}
    </div>
  );
}

function RolesQueue({ f, onFilters, reload, onOpenRole }: { f: IRolesFilters; onFilters: (patch: Partial<IRolesFilters>) => void; reload: number; onOpenRole: (id: string) => void }) {
  const { rows, pagination, loading, error } = useList<QueueItem>('/queue', { ...f, limit: '25' }, reload);
  const set = (k: keyof IRolesFilters, v: string) => onFilters({ [k]: v, page: k === 'page' ? v : '1' });
  useClampPage(pagination, f.page, (p) => onFilters({ page: p }));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <select className={input} value={f.status} onChange={(e) => set('status', e.target.value)} aria-label="Status">
          {['PENDING', 'APPROVED', 'REJECTED', 'QUARANTINED', 'ALL'].map((s) => <option key={s}>{s}</option>)}
        </select>
        <input className={input} placeholder="Company" value={f.company} onChange={(e) => set('company', e.target.value)} />
        <input className={input} placeholder="Name or title" value={f.q} onChange={(e) => set('q', e.target.value)} />
        <select className={input} value={f.decisionMakerType} onChange={(e) => set('decisionMakerType', e.target.value)} aria-label="Classification">
          <option value="">Any classification</option>
          <option value="NONE">Not a decision maker</option>
          {['FOUNDER_CEO', 'MANAGING_DIRECTOR', 'DIRECTOR_PARTNER', 'GENERAL_MANAGER', 'SALES_DECISION_MAKER', 'MARKETING_DECISION_MAKER', 'BUSINESS_DEVELOPMENT_DECISION_MAKER', 'TECHNOLOGY_DECISION_MAKER', 'OPERATIONS_DECISION_MAKER', 'FINANCE_DECISION_MAKER', 'HR_DECISION_MAKER', 'PROCUREMENT_DECISION_MAKER'].map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className={input} value={f.verification} onChange={(e) => set('verification', e.target.value)} aria-label="Verification">
          <option value="">Any verification</option>
          {['UNVERIFIED', 'PARTIALLY_VERIFIED', 'VERIFIED', 'STALE', 'CONFLICTED'].map((s) => <option key={s}>{s}</option>)}
        </select>
        <select className={input} value={f.source} onChange={(e) => set('source', e.target.value)} aria-label="Source">
          <option value="">Any source</option>
          {['GOVERNMENT_REGISTRY', 'WEB_SCRAPING', 'MANUAL_IMPORT', 'API_INTEGRATION', 'USER_SUBMISSION', 'PARTNER_FEED'].map((s) => <option key={s}>{s}</option>)}
        </select>
        <input className={cn(input, 'w-24')} type="number" min={0} max={100} placeholder="Min conf." value={f.minConfidence} onChange={(e) => set('minConfidence', e.target.value)} />
        <select className={input} value={f.hasEvidence} onChange={(e) => set('hasEvidence', e.target.value)} aria-label="Evidence">
          <option value="">Evidence: any</option><option value="true">Has evidence</option><option value="false">No evidence</option>
        </select>
        <select className={input} value={f.sort} onChange={(e) => set('sort', e.target.value)} aria-label="Sort">
          <option value="created_desc">Newest</option><option value="created_asc">Oldest</option><option value="updated_desc">Recently updated</option><option value="confidence_desc">Confidence high-low</option>
        </select>
      </div>

      {loading ? <div className="py-8 text-xs text-zinc-500 flex items-center"><Loader2 className="w-4 h-4 mr-2 animate-spin" />Loading...</div>
        : error ? <div className="py-8 text-xs text-red-600 flex items-center"><CircleAlert className="w-4 h-4 mr-2" />{error}</div>
        : rows.length === 0 ? <div className="py-10 text-center text-xs text-zinc-500">Nothing in this view.</div> : (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-xs">
            <thead className="bg-zinc-50 dark:bg-zinc-900 text-left text-zinc-500">
              <tr>{['Person', 'Company', 'Title', 'Classification', 'State', 'Verification', 'Confidence', 'Evidence', 'Sources', 'Created'].map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} {...rowProps(() => onOpenRole(r.id))} className={ROW_CLASS}>
                  <td className="px-3 py-2 font-semibold">{r.fullName}</td>
                  <td className="px-3 py-2">{r.companyName}</td>
                  <td className="px-3 py-2">{r.jobTitle}</td>
                  <td className="px-3 py-2">{r.decisionMakerLabel ?? <span className="text-zinc-400">none</span>}</td>
                  <td className="px-3 py-2"><span className={pill}>{r.reviewStatus}{r.isPublished ? ' · live' : ''}</span></td>
                  <td className="px-3 py-2">{r.verificationStatus}</td>
                  <td className="px-3 py-2">{r.confidence.score} ({r.confidence.level})</td>
                  <td className="px-3 py-2">{r.evidenceCount === 0 ? <span className="text-red-600">none</span> : `${r.evidenceCount} (${r.verifiedEvidenceCount} verified)`}</td>
                  <td className="px-3 py-2">{r.sourceTypes.join(', ')}</td>
                  <td className="px-3 py-2">{new Date(r.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span>Page {pagination.page} of {pagination.totalPages} · {pagination.totalItems} roles</span>
          <div className="flex gap-2">
            <button className={btn} disabled={pagination.page <= 1} onClick={() => set('page', String(pagination.page - 1))}>Previous</button>
            <button className={btn} disabled={pagination.page >= pagination.totalPages} onClick={() => set('page', String(pagination.page + 1))}>Next</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="space-y-1.5"><h4 className="text-[11px] uppercase tracking-wider font-bold text-zinc-500">{title}</h4>{children}</section>;
}

const ATTRIBUTION_TONE: Record<AttributionTone, string> = { ok: 'border-emerald-300 text-emerald-700', warn: 'border-amber-400 text-amber-700', muted: 'text-zinc-500' };

/** Where this contact came from, read against the dossier's company (reviewer information only; it changes nothing for customers). */
function ContactAttributionBadge({ attribution }: { attribution?: IContactAttributionInfo }) {
  const b = attributionBadge(attribution);
  if (!b) return null;
  return <span className={cn(pill, ATTRIBUTION_TONE[b.tone])} title={b.hint} aria-label={`${b.label}. ${b.hint}`}>{b.label}</span>;
}

/** Where the import says this relationship came from (read-only; internal reviewers only). */
function ProvenanceSection({ provenance }: { provenance?: IProvenance }) {
  const v = buildProvenanceView(provenance);
  return (
    <Section title={v.heading}>
      {v.empty ? <p className="text-zinc-500">{v.emptyMessage}</p> : v.rows.map((r) => (
        <div key={r.key} className="rounded-lg border border-zinc-300 dark:border-zinc-600 p-2">
          <p><b>{r.source}</b> · batch <span className="font-mono">{r.batchRef}</span></p>
          <p className="text-zinc-500">source record: <span className="font-mono">{r.sourceRecord}</span></p>
          <p className="text-zinc-500">acquired {r.acquired} · observed {r.observed}</p>
          {(r.reportedTitle || r.reportedCurrent) && <p className="text-zinc-500">source said: {r.reportedTitle ?? '-'}{r.reportedCurrent ? ` · ${r.reportedCurrent}` : ''}</p>}
        </div>
      ))}
      {v.moreNote && <p className="text-zinc-500">{v.moreNote}</p>}
    </Section>
  );
}

const SOURCE_OPTIONS = ['GOVERNMENT_REGISTRY', 'WEB_SCRAPING', 'MANUAL_IMPORT', 'PARTNER_FEED', 'API_INTEGRATION', 'USER_SUBMISSION'];

/** Evidence entry for one claim: pick evidence already on file, or record what the reviewer checked. */
function VerifyForm({ claim, busy, onCancel, onSubmit }: { claim: Claim; busy: boolean; onCancel: () => void; onSubmit: (body: Record<string, unknown>) => void }) {
  const [evidenceId, setEvidenceId] = useState('');
  const [type, setType] = useState(claim.acceptedEvidenceTypes[0]);
  const [source, setSource] = useState('MANUAL_IMPORT');
  const [ref, setRef] = useState('');
  const [note, setNote] = useState('');
  const isUrl = /^https?:\/\//i.test(ref.trim());
  const submit = () => {
    if (note.trim().length < 3) return toast.error('Explain why this evidence supports the claim.');
    if (!evidenceId && !ref.trim()) return toast.error('Cite where you saw it (reference or URL), or pick evidence on file.');
    onSubmit(evidenceId
      ? { evidenceId, note: note.trim() }
      : { evidence: { sourceType: source, evidenceType: type, ...(isUrl ? { sourceUrl: ref.trim() } : { sourceReference: ref.trim() }) }, note: note.trim() });
  };
  return (
    <div className="space-y-2 rounded-lg bg-zinc-50 dark:bg-zinc-900 p-2">
      {claim.eligibleEvidence.length > 0 && (
        <select className={cn(input, 'w-full')} value={evidenceId} onChange={(e) => setEvidenceId(e.target.value)} aria-label="Evidence on file">
          <option value="">Record new evidence...</option>
          {claim.eligibleEvidence.map((e) => <option key={e.id} value={e.id}>{e.evidenceType} · {e.reference}</option>)}
        </select>
      )}
      {!evidenceId && (
        <div className="grid grid-cols-2 gap-2">
          <select className={input} value={type} onChange={(e) => setType(e.target.value)} aria-label="Evidence type">
            {claim.acceptedEvidenceTypes.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className={input} value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source type">
            {SOURCE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input className={cn(input, 'col-span-2')} placeholder="Reference or URL (filing no., page, call log)" value={ref} onChange={(e) => setRef(e.target.value)} />
        </div>
      )}
      <input className={cn(input, 'w-full')} placeholder="Why does this support the claim? (audited)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="flex gap-2">
        <button className={btnPrimary} disabled={busy} onClick={submit}>Verify {claim.label.toLowerCase()}</button>
        <button className={btn} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function RoleDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [failure, setFailure] = useState<IDrawerFailure | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useDrawerA11y(ref, onClose);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [contactIds, setContactIds] = useState<string[]>([]);
  const [edit, setEdit] = useState({ fullName: '', jobTitle: '', isCurrent: '', endDate: '' });
  const [vf, setVf] = useState<string | null>(null);

  const load = useCallback(() => call('GET', `/roles/${id}`).then((r) => { setD(r.data); setFailure(null); }).catch((e: Error & { status?: number }) => setFailure(classifyLoadFailure(e.status, e.message, 'role'))), [id]);
  const phase = drawerPhase(!!d, failure);
  useEffect(() => { load(); }, [load]);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      toast.success(label);
      onChanged();
      await load();
      setReason('');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const needReason = () => { if (reason.trim().length < 3) { toast.error('Enter a reason (3+ characters).'); return false; } return true; };

  const editBody = useMemo(() => {
    const b: Record<string, unknown> = { reason };
    if (edit.fullName.trim()) b.fullName = edit.fullName.trim();
    if (edit.jobTitle.trim()) b.jobTitle = edit.jobTitle.trim();
    if (edit.isCurrent) b.isCurrent = edit.isCurrent === 'true';
    if (edit.endDate) b.endDate = edit.endDate;
    return b;
  }, [edit, reason]);

  return (
    <div ref={ref} tabIndex={-1} className="fixed inset-0 z-50 flex justify-end bg-black/40 outline-none" role="dialog" aria-modal="true" aria-label="Role review" aria-busy={phase === 'loading'}>
      <div className="w-full max-w-2xl bg-white dark:bg-zinc-950 h-full overflow-y-auto p-5 space-y-5 text-xs">
        <div className="flex items-start justify-between">
          <h3 className="text-base font-bold">{drawerTitle(phase, 'role', failure, d ? `${d.person.fullName} · ${d.role.jobTitle}` : '')}</h3>
          <button onClick={onClose} aria-label="Close" className="cursor-pointer"><X className="w-4 h-4" /></button>
        </div>
        {failure && (
          <div role="alert" className="space-y-2">
            <p className="text-red-600">{failure.message}</p>
            {failure.retryable && <button className={btn} onClick={() => void load()}>Retry</button>}
          </div>
        )}
        {!d ? (failure ? null : <Loader2 role="status" aria-label="Loading" className="w-4 h-4 animate-spin" />) : (
          <>
            <Section title="Identity">
              <p><b>{d.person.fullName}</b> at <b>{d.company.name}</b> ({d.company.status}) · {d.role.jobTitle}</p>
              <p>Classification: {d.role.decisionMakerLabel ?? 'not a decision maker'} · {d.role.department} · {d.role.seniorityLevel} ({d.role.classificationSource}) · {d.role.isCurrent ? 'current' : 'former'}</p>
              <p>State: <span className={pill}>{d.role.reviewStatus}{d.role.isPublished ? ' · published' : ''}</span> Person: <span className={pill}>{d.person.dataStatus}</span></p>
              {d.person.linkedinUrl && <p>LinkedIn: {d.person.linkedinUrl}</p>}
            </Section>
            <Section title="Contact (internal view - customers only see published contacts after unlock)">
              {d.contacts.length === 0 ? <p className="text-zinc-500">None on record.</p> : d.contacts.map((c) => (
                <label key={c.id} className="flex items-center gap-2">
                  <input type="checkbox" disabled={!c.canPublish || c.isPublished} checked={contactIds.includes(c.id)}
                    onChange={(e) => setContactIds((s) => e.target.checked ? [...s, c.id] : s.filter((x) => x !== c.id))} />
                  <span className="font-mono">{c.type}: {c.value}</span>
                  <span className={pill}>{c.isPublished ? 'published' : 'hidden'}</span>
                  <span className="text-zinc-500">{c.verificationStatus} · {c.evidenceCount} evidence</span>
                  <ContactAttributionBadge attribution={c.attribution} />
                  {c.isPublished && <button className={btn} disabled={busy} onClick={() => run('Contact unpublished', () => call('POST', `/contacts/${c.id}/unpublish`, { reason: reason || 'unpublished by reviewer' }))}>Unpublish</button>}
                </label>
              ))}
            </Section>
            <Section title="Quality">
              <p>Confidence {d.quality.confidence.score} ({d.quality.confidence.level}) · Verification {d.quality.effectiveVerificationStatus} (stored {d.quality.storedVerificationStatus})</p>
              <p>Last verified: {d.quality.lastVerifiedAt ? new Date(d.quality.lastVerifiedAt).toLocaleDateString() : 'never'} · First seen {new Date(d.role.firstSeenAt).toLocaleDateString()} · Last seen {new Date(d.role.lastSeenAt).toLocaleDateString()}</p>
            </Section>
            <Section title="Verification (separate from approval; every claim needs evidence)">
              {d.verification.map((c) => {
                const key = `${c.claim}:${c.contactId ?? ''}`;
                return (
                  <div key={key} className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-2 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <b className="w-40">{c.label}</b>
                      <span className="font-mono truncate max-w-[16rem]">{c.displayValue ?? '-'}</span>
                      <span className={cn(pill, c.state === 'VERIFIED' && 'border-emerald-400 text-emerald-700', c.state === 'DISPUTED' && 'border-red-400 text-red-700', (c.state === 'NEEDS_REVIEW' || c.state === 'STALE') && 'border-amber-400 text-amber-700')}>
                        {c.state === 'NEEDS_REVIEW' ? 'Needs review' : c.state === 'UNVERIFIED' ? 'Unverified' : c.state === 'VERIFIED' ? 'Verified' : c.state === 'STALE' ? 'Stale' : 'Disputed'}
                      </span>
                      <button className={btn} disabled={busy} onClick={() => setVf(vf === key ? null : key)}>{c.state === 'VERIFIED' ? 'Add evidence' : 'Verify'}</button>
                      {c.state !== 'DISPUTED' && <button className={cn(btn, 'text-red-700')} disabled={busy} onClick={() => needReason() && run('Claim disputed', () => call('POST', `/roles/${id}/dispute`, { claim: c.claim, contactId: c.contactId ?? undefined, note: reason }, VBASE))}>Dispute</button>}
                    </div>
                    {c.state === 'NEEDS_REVIEW' && <p className="text-amber-700">Changed after it was verified (was &ldquo;{c.previousValue}&rdquo;). Verify the new value.</p>}
                    {c.verifiedAt && <p className="text-zinc-500">{c.state === 'DISPUTED' ? 'Disputed' : 'Verified'} by {c.verifiedBy} on {new Date(c.verifiedAt).toLocaleDateString()}{c.basis ? ` · ${c.basis.evidenceType}${c.basis.reference ? ` · ${c.basis.reference}` : ''}` : ''}{c.note ? ` · “${c.note}”` : ''}</p>}
                    {vf === key && <VerifyForm claim={c} busy={busy} onCancel={() => setVf(null)} onSubmit={(body) => run('Claim verified', async () => { await call('POST', `/roles/${id}/verify`, { claim: c.claim, contactId: c.contactId ?? undefined, ...body }, VBASE); setVf(null); })} />}
                  </div>
                );
              })}
              <p className="text-zinc-500">Use the reason box further down for &ldquo;Dispute&rdquo;. Verifying does not approve or publish anything.</p>
            </Section>
            <ProvenanceSection provenance={d.provenance} />
            <Section title={`Evidence (${d.evidence.length})`}>
              {d.evidence.length === 0 ? <p className="text-red-600">No evidence on record. This role cannot be published.</p> : d.evidence.map((e) => (
                <div key={e.id} className={cn('rounded-lg border p-2', e.appliesToThisRole ? 'border-zinc-300 dark:border-zinc-600' : 'border-dashed border-zinc-200 dark:border-zinc-800')}>
                  <p><b>{e.sourceLabel}</b> · {e.evidenceType} · <span className={pill}>{e.status}</span> · applies to: {e.scope}{e.contactType ? ` (${e.contactType})` : ''}</p>
                  <p className="text-zinc-500">ref: {e.sourceReference ?? '-'} {e.sourceUrl ? `· ${e.sourceUrl}` : ''}</p>
                  <p className="text-zinc-500">observed {new Date(e.observedAt).toLocaleString()}{e.verifiedAt ? ` · verified ${new Date(e.verifiedAt).toLocaleDateString()}` : ''}</p>
                </div>
              ))}
            </Section>
            {d.otherRoles.length > 0 && (
              <Section title="Other roles of this person (reviewed separately)">
                {d.otherRoles.map((r) => <p key={r.id}>{r.jobTitle} at {r.companyName} · {r.reviewStatus}{r.isPublished ? ' · live' : ''}</p>)}
              </Section>
            )}
            <Section title="Review">
              <input className={cn(input, 'w-full')} placeholder="Reason (required for edit, reject, quarantine, unpublish, suppress)" value={reason} onChange={(e) => setReason(e.target.value)} />
              {d.readiness.blockers.length > 0 && <p className="text-amber-700">Blocked: {d.readiness.blockers.join(', ')}</p>}
              <div className="flex flex-wrap gap-2">
                <button className={btnPrimary} disabled={busy || !d.readiness.canApprove || d.role.isPublished}
                  onClick={() => run('Role approved and published', () => call('POST', `/roles/${id}/approve`, { reason: reason || undefined, publishContactIds: contactIds }))}>
                  Approve this role{contactIds.length ? ` + ${contactIds.length} contact(s)` : ''}
                </button>
                <button className={btn} disabled={busy} onClick={() => needReason() && run('Role rejected', () => call('POST', `/roles/${id}/reject`, { reason }))}>Reject</button>
                {d.role.reviewStatus !== 'REJECTED' && <button className={btn} disabled={busy} onClick={() => needReason() && run('Role quarantined', () => call('POST', `/roles/${id}/quarantine`, { reason }))}>Quarantine</button>}
                {(d.role.reviewStatus === 'REJECTED' || d.role.reviewStatus === 'QUARANTINED') && <button className={btn} disabled={busy} onClick={() => run('Role reopened', () => call('POST', `/roles/${id}/reopen`, { reason: reason || undefined }))}>Reopen</button>}
                {d.role.isPublished && <button className={btn} disabled={busy} onClick={() => needReason() && run('Role unpublished', () => call('POST', `/roles/${id}/unpublish`, { reason }))}>Unpublish</button>}
                <button className={cn(btn, 'text-red-700')} disabled={busy} onClick={() => needReason() && confirm('Suppress this person everywhere and block re-ingestion?') && run('Person suppressed', () => call('POST', `/people/${d.person.id}/suppress`, { reason }))}>Suppress person</button>
              </div>
            </Section>
            <Section title="Edit (audited; reason required; cannot mark anything verified)">
              <div className="grid grid-cols-2 gap-2">
                <input className={input} placeholder={`Name (${d.person.fullName})`} value={edit.fullName} onChange={(e) => setEdit({ ...edit, fullName: e.target.value })} />
                <input className={input} placeholder={`Title (${d.role.jobTitle})`} value={edit.jobTitle} onChange={(e) => setEdit({ ...edit, jobTitle: e.target.value })} />
                <select className={input} value={edit.isCurrent} onChange={(e) => setEdit({ ...edit, isCurrent: e.target.value })} aria-label="Current or former">
                  <option value="">Current/former: unchanged</option><option value="true">Current</option><option value="false">Former</option>
                </select>
                <input className={input} type="date" value={edit.endDate} onChange={(e) => setEdit({ ...edit, endDate: e.target.value })} aria-label="End date" />
              </div>
              <div className="flex gap-2">
                <button className={btn} disabled={busy} onClick={() => needReason() && run('Saved', () => call('PATCH', `/roles/${id}`, editBody))}>Save changes</button>
                <button className={btnPrimary} disabled={busy || !d.readiness.canApprove} onClick={() => needReason() && run('Edited and published', () => call('POST', `/roles/${id}/edit-and-approve`, { ...editBody, publishContactIds: contactIds }))}>Edit &amp; approve</button>
              </div>
            </Section>
            <Section title="Audit trail">
              {d.auditTrail.length === 0 ? <p className="text-zinc-500">No review actions yet.</p> : d.auditTrail.map((a) => (
                <p key={a.id}>{new Date(a.createdAt).toLocaleString()} · <b>{a.action}</b> · {a.reviewerEmail ?? a.newValues?.reviewedBy ?? 'system'}{a.newValues?.reason ? ` · “${a.newValues.reason}”` : ''}</p>
              ))}
            </Section>
          </>
        )}
      </div>
    </div>
  );
}

function QuarantineQueue({ f, onFilters, reload, onOpen }: { f: IQuarantineFilters; onFilters: (patch: Partial<IQuarantineFilters>) => void; reload: number; onOpen: (id: string) => void }) {
  const { status, code, page } = f;
  const setStatus = (v: string) => onFilters({ status: v, page: '1' });
  const setCode = (v: string) => onFilters({ code: v, page: '1' });
  const setPage = (v: string) => onFilters({ page: v });
  const { rows, pagination, loading, error } = useList<QItem>('/quarantine', { status, code: code || undefined, page, limit: '25' }, reload);
  useClampPage(pagination, page, setPage);

  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-center">
        <select className={input} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Quarantine status">
          {['PENDING', 'RESOLVED', 'DISCARDED', 'ALL'].map((s) => <option key={s}>{s}</option>)}
        </select>
        <select className={input} value={code} onChange={(e) => setCode(e.target.value)} aria-label="Reason">
          <option value="">Any reason</option>
          {['AMBIGUOUS_IDENTITY', 'PERSON_SUPPRESSED', 'BUSINESS_NOT_FOUND', 'AMBIGUOUS_BUSINESS', 'MISSING_TITLE', 'NAME_INCOMPLETE', 'MISSING_NAME', 'INVALID_SOURCE_TYPE', 'REVIEWER_QUARANTINE'].map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : error ? <p className="text-xs text-red-600">{error}</p> : rows.length === 0 ? <p className="py-8 text-center text-xs text-zinc-500">Nothing in quarantine.</p> : (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-xs">
            <thead className="bg-zinc-50 dark:bg-zinc-900 text-left text-zinc-500"><tr>{['Person', 'Title', 'Reason', 'Batch', 'State', 'Created'].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} {...rowProps(() => onOpen(r.id))} className={ROW_CLASS}>
                  <td className="px-3 py-2 font-semibold">{r.personName ?? '-'}</td>
                  <td className="px-3 py-2">{r.jobTitle ?? '-'}</td>
                  <td className="px-3 py-2">{r.reasons.map((x) => x.code).join(', ')}</td>
                  <td className="px-3 py-2">{r.batchRef ?? '-'}</td>
                  <td className="px-3 py-2"><span className={pill}>{r.status}</span></td>
                  <td className="px-3 py-2">{new Date(r.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex gap-2 text-xs items-center">
          <button className={btn} disabled={pagination.page <= 1} onClick={() => setPage(String(pagination.page - 1))}>Previous</button>
          <span>Page {pagination.page} / {pagination.totalPages}</span>
          <button className={btn} disabled={pagination.page >= pagination.totalPages} onClick={() => setPage(String(pagination.page + 1))}>Next</button>
        </div>
      )}
    </div>
  );
}

function QuarantineDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<any>(null);
  const [failure, setFailure] = useState<IDrawerFailure | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useDrawerA11y(ref, onClose);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [patch, setPatch] = useState({ personName: '', jobTitle: '', linkedinUrl: '', email: '', businessSlug: '' });
  const [personId, setPersonId] = useState('');
  const load = useCallback(() => call('GET', `/quarantine/${id}`).then((r) => { setD(r.data); setFailure(null); }).catch((e: Error & { status?: number }) => setFailure(classifyLoadFailure(e.status, e.message, 'quarantine item'))), [id]);
  const phase = drawerPhase(!!d, failure);
  useEffect(() => { load(); }, [load]);

  const run = async (label: string, fn: () => Promise<any>) => {
    if (reason.trim().length < 3) return toast.error('Enter a reason (3+ characters).');
    setBusy(true);
    try {
      const r = await fn();
      const out = r?.data;
      if (out?.outcome === 'QUARANTINED') toast.error(`Still quarantined: ${(out.reasons ?? []).map((x: any) => x.code).join(', ')}`);
      else toast.success(label);
      onChanged();
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const cleanPatch = Object.fromEntries(Object.entries(patch).filter(([, v]) => v.trim()));
  const pending = d?.status === 'PENDING';

  return (
    <div ref={ref} tabIndex={-1} className="fixed inset-0 z-50 flex justify-end bg-black/40 outline-none" role="dialog" aria-modal="true" aria-label="Quarantine item" aria-busy={phase === 'loading'}>
      <div className="w-full max-w-2xl bg-white dark:bg-zinc-950 h-full overflow-y-auto p-5 space-y-4 text-xs">
        <div className="flex justify-between"><h3 className="text-base font-bold">{drawerTitle(phase, 'quarantine item', failure, 'Quarantined record')}</h3><button onClick={onClose} aria-label="Close" className="cursor-pointer"><X className="w-4 h-4" /></button></div>
        {failure && (
          <div role="alert" className="space-y-2">
            <p className="text-red-600">{failure.message}</p>
            {failure.retryable && <button className={btn} onClick={() => void load()}>Retry</button>}
          </div>
        )}
        {!d ? (failure ? null : <Loader2 role="status" aria-label="Loading" className="w-4 h-4 animate-spin" />) : (
          <>
            <Section title="Why it is here">
              {d.reasons.map((r: any, i: number) => <p key={i}><b>{r.code}</b>: {r.message}</p>)}
              {d.validationErrors?.length > 0 && <p>Validation: {d.validationErrors.map((r: any) => r.code).join(', ')}</p>}
              {d.companyMatch && <p>Company match: <b>{d.companyMatch.status}</b>{d.companyMatch.businessName ? ` (${d.companyMatch.businessName})` : ''}</p>}
              {d.resolution && <p>Closed: {d.resolution.action} by {d.resolution.by} - {d.resolution.note}</p>}
            </Section>
            {d.identityCandidates?.length > 0 && (
              <Section title="Possible identities (same name at this company)">
                {d.identityCandidates.map((c: any) => <p key={c.roleId}>{c.fullName} · {c.jobTitle} · {c.reviewStatus} · {c.linkedinUrl ?? 'no LinkedIn'} <button className="underline cursor-pointer" onClick={() => setPersonId(c.personId)}>use for suppress</button></p>)}
              </Section>
            )}
            <Section title="Raw payload"><pre className="bg-zinc-50 dark:bg-zinc-900 rounded-lg p-2 overflow-x-auto">{JSON.stringify(d.raw, null, 2)}</pre></Section>
            {d.normalized && <Section title="Normalized payload"><pre className="bg-zinc-50 dark:bg-zinc-900 rounded-lg p-2 overflow-x-auto">{JSON.stringify(d.normalized, null, 2)}</pre></Section>}
            {d.source && <Section title="Source"><p>{d.source.type} · {d.source.label ?? ''} · {d.source.reference ?? ''} · {d.source.observedAt ?? ''}</p></Section>}
            {pending && (
              <Section title="Actions (reason required; nothing is retried automatically)">
                <input className={cn(input, 'w-full')} placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
                {d.kind === 'INGESTION' && (
                  <div className="grid grid-cols-2 gap-2">
                    {(Object.keys(patch) as Array<keyof typeof patch>).map((k) => <input key={k} className={input} placeholder={`Correct ${k}`} value={patch[k]} onChange={(e) => setPatch({ ...patch, [k]: e.target.value })} />)}
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  {d.kind === 'INGESTION' && <button className={btnPrimary} disabled={busy} onClick={() => run('Retried', () => call('POST', `/quarantine/${id}/retry`, { reason, patch: cleanPatch }))}>Retry{Object.keys(cleanPatch).length ? ' with corrections' : ''}</button>}
                  <button className={btn} disabled={busy} onClick={() => run(d.kind === 'INGESTION' ? 'Resolved' : 'Role reopened', () => call('POST', `/quarantine/${id}/resolve`, { reason }))}>{d.kind === 'INGESTION' ? 'Resolve' : 'Resolve (reopen role)'}</button>
                  <button className={btn} disabled={busy} onClick={() => run('Rejected', () => call('POST', `/quarantine/${id}/reject`, { reason }))}>Reject</button>
                  <input className={input} placeholder="personId (optional)" value={personId} onChange={(e) => setPersonId(e.target.value)} />
                  <button className={cn(btn, 'text-red-700')} disabled={busy} onClick={() => confirm('Suppress this person and block re-ingestion?') && run('Suppressed', () => call('POST', `/quarantine/${id}/suppress`, { reason, personId: personId || undefined }))}>Suppress</button>
                </div>
              </Section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
