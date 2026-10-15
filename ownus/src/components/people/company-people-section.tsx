'use client';

import { useEffect, useMemo, useState, type ComponentType } from 'react';
import {
  BadgeCheck,
  Bookmark,
  BookmarkCheck,
  CircleAlert,
  Download,
  Loader2,
  Lock,
  LockOpen,
  Mail,
  MapPin,
  Phone,
  Search,
  ShieldCheck,
  Smartphone,
  Users,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Linkedin } from '@/components/ui/linkedin-icon';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import {
  DEFAULT_PEOPLE_FILTERS,
  assertionCopy,
  buildPeopleQuery,
  confidenceCopy,
  hasActiveFilters,
  lastVerifiedCopy,
  personInitials,
  verificationCopy,
  type CompanyPeopleResponse,
  type ContactField,
  type PeopleFilters,
  type PeopleTaxonomy,
  type PersonCard,
} from '@/lib/people';

const selectClass =
  'h-9 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2.5 text-xs text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:focus:ring-zinc-100';

type ApiError = { message?: string; statusCode?: number };
interface UnlockResponse {
  alreadyUnlocked?: boolean;
  creditsSpent?: number;
  balance?: number;
  dailyCredits?: number;
  purchasedCredits?: number;
  person?: { contacts?: PersonCard['contacts'] };
}
interface PersonDetail {
  error?: boolean;
  roles?: Array<PersonCard & { business?: { name?: string } | null }>;
}

interface Props {
  businessId: string;
  businessName: string;
}

export function CompanyPeopleSection({ businessId, businessName }: Props) {
  const { wallet, setWalletBalance } = useAuth();
  const [taxonomy, setTaxonomy] = useState<PeopleTaxonomy | null>(null);
  const [filters, setFilters] = useState<PeopleFilters>(DEFAULT_PEOPLE_FILTERS);
  const [searchText, setSearchText] = useState('');
  const [result, setResult] = useState<{ key: string; data?: CompanyPeopleResponse; error?: string } | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [confirming, setConfirming] = useState<PersonCard | null>(null);
  const [unlockingId, setUnlockingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    apiClient.people.taxonomy().then(setTaxonomy).catch(() => setTaxonomy(null));
  }, []);

  // Debounce the free-text search so typing does not fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => (f.q === searchText ? f : { ...f, q: searchText, page: 1 })), 300);
    return () => clearTimeout(t);
  }, [searchText]);

  // "loading" is derived (the stored result belongs to a different request), so the effect never
  // sets state synchronously.
  const requestKey = useMemo(() => JSON.stringify([businessId, filters, reloadToken]), [businessId, filters, reloadToken]);
  useEffect(() => {
    let cancelled = false;
    apiClient.people
      .listForCompany(businessId, buildPeopleQuery(filters))
      .then((d: CompanyPeopleResponse) => !cancelled && setResult({ key: requestKey, data: d }))
      .catch((err: ApiError) =>
        !cancelled && setResult({ key: requestKey, error: err?.message || 'Could not load people for this company.' }),
      );
    return () => {
      cancelled = true;
    };
  }, [businessId, filters, requestKey]);

  const loading = result?.key !== requestKey;
  const data = result?.data ?? null;
  const error = !loading ? (result?.error ?? null) : null;
  const load = () => setReloadToken((n) => n + 1);

  const patchPerson = (personId: string, patch: (p: PersonCard) => PersonCard) =>
    setResult((r) =>
      r?.data ? { ...r, data: { ...r.data, people: r.data.people.map((p) => (p.id === personId ? patch(p) : p)) } } : r,
    );

  const setFilter = <K extends keyof PeopleFilters>(key: K, value: PeopleFilters[K]) =>
    setFilters((f) => ({ ...f, [key]: value, page: key === 'page' ? (value as number) : 1 }));

  const doUnlock = async (person: PersonCard) => {
    setUnlockingId(person.id);
    try {
      const res: UnlockResponse = await apiClient.people.unlock(person.id);
      if (res?.balance !== undefined) setWalletBalance(res.balance, res.dailyCredits, res.purchasedCredits);
      // Server response carries the revealed values; merge them, never guess client-side.
      const revealed = res?.person?.contacts;
      if (revealed) patchPerson(person.id, (p) => ({ ...p, contacts: revealed }));
      toast.success(
        res?.alreadyUnlocked ? 'Contact was already unlocked.' : `Contact unlocked (${res?.creditsSpent ?? 1} credit).`,
      );
    } catch (e) {
      const err = e as ApiError;
      toast.error(
        err?.statusCode === 402
          ? 'Not enough credits to unlock this contact. Top up from the Credits page.'
          : err?.message || 'Could not unlock this contact.',
      );
    } finally {
      setUnlockingId(null);
      setConfirming(null);
    }
  };

  const doSave = async (person: PersonCard) => {
    setSavingId(person.id);
    try {
      await apiClient.savedLeads.save({ businessId: person.businessId, personId: person.id });
      patchPerson(person.id, (p) => ({ ...p, isSaved: true }));
      toast.success(`Saved ${person.fullName} to your leads.`);
    } catch (e) {
      const err = e as ApiError;
      toast.error(err?.message || 'Could not save this person.');
    } finally {
      setSavingId(null);
    }
  };

  const doExport = async () => {
    setExporting(true);
    try {
      const csv = await apiClient.people.exportUnlocked();
      const rows = String(csv).trim().split('\n').length - 1;
      if (rows <= 0) {
        toast.info('You have not unlocked any contacts yet, so there is nothing to export.');
        return;
      }
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `orion-unlocked-people-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`Exported ${rows} unlocked contact${rows === 1 ? '' : 's'}.`);
    } catch (e) {
      const err = e as ApiError;
      toast.error(err?.message || 'Export failed.');
    } finally {
      setExporting(false);
    }
  };

  const summary = data?.summary;
  const unlockCost = taxonomy?.unlockCostCredits ?? 1;
  const active = hasActiveFilters(filters);
  const balance = wallet?.balance;

  return (
    <section className="bg-white dark:bg-zinc-950 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xs p-6 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100 flex items-center">
            <Users className="w-4 h-4 mr-2 text-zinc-700 dark:text-zinc-300" />
            People / Decision Makers
          </h2>
          <p className="mt-1 text-xs text-zinc-500 max-w-xl">
            People Orion has on record at {businessName}. Roles are labelled Known, Likely or Unverified based on the
            evidence behind them. Contact details stay locked until you unlock a person.
          </p>
        </div>
        <button
          onClick={doExport}
          disabled={exporting}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 px-3 h-9 text-xs font-semibold text-zinc-800 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors cursor-pointer disabled:opacity-60"
        >
          {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          Export unlocked
        </button>
      </div>

      {summary && summary.total > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          {[
            ['People on record', summary.total],
            ['Decision makers', summary.decisionMakers],
            ['Verified', summary.verified],
            ['Contact available', summary.withContact],
          ].map(([label, value]) => (
            <div key={label as string} className="rounded-lg bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800 px-3 py-2">
              <div className="text-[11px] uppercase tracking-wider font-semibold text-zinc-500">{label}</div>
              <div className="mt-0.5 text-base font-bold font-mono text-zinc-900 dark:text-zinc-100">{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Search people by name or title..."
            aria-label="Search people"
            className="w-full h-9 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 pl-8 pr-3 text-xs placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:focus:ring-zinc-100"
          />
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <select aria-label="Department" className={selectClass} value={filters.department} onChange={(e) => setFilter('department', e.target.value)}>
            <option value="">All departments</option>
            {taxonomy?.departments.filter((d) => d.key !== 'UNKNOWN').map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
          </select>
          <select aria-label="Seniority" className={selectClass} value={filters.seniority} onChange={(e) => setFilter('seniority', e.target.value)}>
            <option value="">All seniority</option>
            {taxonomy?.seniorityLevels.filter((d) => d.key !== 'UNKNOWN').map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
          </select>
          <select aria-label="Decision maker type" className={selectClass} value={filters.decisionMakerType} onChange={(e) => setFilter('decisionMakerType', e.target.value)}>
            <option value="">Any decision maker type</option>
            {taxonomy?.decisionMakerTypes.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
          </select>
          <select aria-label="Verification" className={selectClass} value={filters.verification} onChange={(e) => setFilter('verification', e.target.value)}>
            <option value="">Any verification</option>
            <option value="VERIFIED">Verified</option>
            <option value="PARTIALLY_VERIFIED">Partly verified</option>
            <option value="UNVERIFIED">Unverified</option>
            <option value="STALE">Needs re-verification</option>
            <option value="CONFLICTED">Conflicting sources</option>
          </select>
          <select aria-label="Role status" className={selectClass} value={filters.status} onChange={(e) => setFilter('status', e.target.value as PeopleFilters['status'])}>
            <option value="current">Current roles</option>
            <option value="former">Former roles</option>
            <option value="all">All roles</option>
          </select>
          <label className="inline-flex items-center gap-1.5 text-xs text-zinc-700 dark:text-zinc-300 cursor-pointer">
            <input type="checkbox" checked={filters.hasContact} onChange={(e) => setFilter('hasContact', e.target.checked)} />
            Contact available
          </label>
          <label className="inline-flex items-center gap-1.5 text-xs text-zinc-700 dark:text-zinc-300 cursor-pointer">
            <input type="checkbox" checked={filters.decisionMakersOnly} onChange={(e) => setFilter('decisionMakersOnly', e.target.checked)} />
            Decision makers only
          </label>
          {active && (
            <button
              onClick={() => { setSearchText(''); setFilters(DEFAULT_PEOPLE_FILTERS); }}
              className="text-xs font-medium text-zinc-500 underline hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Results */}
      {loading && !data ? (
        <div className="flex items-center justify-center py-10 text-xs text-zinc-500">
          <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Loading people...
        </div>
      ) : error ? (
        <div className="flex flex-col items-center py-10 space-y-2 text-center">
          <CircleAlert className="w-6 h-6 text-zinc-400" />
          <p className="text-xs text-zinc-600 dark:text-zinc-400">{error}</p>
          <button onClick={load} className="text-xs font-semibold underline cursor-pointer">Try again</button>
        </div>
      ) : data && data.people.length === 0 ? (
        <div className="flex flex-col items-center py-10 space-y-2 text-center">
          <Users className="w-6 h-6 text-zinc-400" />
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {active ? 'No people match these filters' : 'No people published for this company yet'}
          </p>
          <p className="text-xs text-zinc-500 max-w-sm">
            {active
              ? 'Try removing a filter.'
              : 'Orion only shows people once their role has been added and published. Check back later.'}
          </p>
        </div>
      ) : (
        <div className={cn('space-y-3', loading && 'opacity-60 transition-opacity')}>
          {data?.people.map((p) => (
            <PersonCardView
              key={p.id}
              person={p}
              unlocking={unlockingId === p.id}
              saving={savingId === p.id}
              onUnlock={() => setConfirming(p)}
              onSave={() => doSave(p)}
            />
          ))}
          {data && data.pagination.totalPages > 1 && (
            <div className="flex items-center justify-between pt-2 text-xs text-zinc-500">
              <span>Page {data.pagination.page} of {data.pagination.totalPages} · {data.pagination.totalItems} people</span>
              <div className="flex gap-2">
                <button disabled={filters.page <= 1} onClick={() => setFilter('page', filters.page - 1)} className="px-3 h-8 rounded-lg border border-zinc-200 dark:border-zinc-800 disabled:opacity-40 cursor-pointer">Previous</button>
                <button disabled={filters.page >= data.pagination.totalPages} onClick={() => setFilter('page', filters.page + 1)} className="px-3 h-8 rounded-lg border border-zinc-200 dark:border-zinc-800 disabled:opacity-40 cursor-pointer">Next</button>
              </div>
            </div>
          )}
        </div>
      )}

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4" role="dialog" aria-modal="true" aria-label="Unlock contact">
          <div className="w-full max-w-sm bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 flex items-center justify-center">
                <Zap className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Unlock {confirming.fullName}?</h3>
                <p className="text-xs text-zinc-500">{confirming.jobTitle}</p>
              </div>
            </div>
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              This uses {unlockCost} credit{unlockCost === 1 ? '' : 's'} and reveals the verified contact details Orion
              has published for this person. Unlocking again later is free.
              {typeof balance === 'number' && <> Your balance: <span className="font-semibold">{balance}</span>.</>}
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirming(null)} className="px-3 h-9 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs font-semibold cursor-pointer">Cancel</button>
              <button
                onClick={() => doUnlock(confirming)}
                disabled={unlockingId === confirming.id}
                className="inline-flex items-center px-3 h-9 rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-xs font-semibold cursor-pointer disabled:opacity-60"
              >
                {unlockingId === confirming.id && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                Unlock ({unlockCost} credit{unlockCost === 1 ? '' : 's'})
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function ContactRow({ icon: Icon, label, field, unlocked }: { icon: ComponentType<{ className?: string }>; label: string; field: ContactField; unlocked: boolean }) {
  if (!field.available) {
    return (
      <div className="flex items-center gap-2 text-xs text-zinc-400">
        <Icon className="w-3.5 h-3.5" /> {label}: <span>Not available</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300 min-w-0">
      <Icon className="w-3.5 h-3.5 shrink-0" />
      <span className="shrink-0">{label}:</span>
      {unlocked && field.value ? (
        <span className="font-mono truncate select-all">{field.value}</span>
      ) : (
        <span className="inline-flex items-center gap-1 text-zinc-500"><Lock className="w-3 h-3" /> Locked</span>
      )}
      <span
        className={cn(
          'shrink-0 inline-flex items-center gap-0.5 text-[11px]',
          field.verificationStatus === 'VERIFIED' ? 'text-zinc-900 dark:text-zinc-100 font-semibold' : 'text-zinc-500',
        )}
      >
        {field.verificationStatus === 'VERIFIED' && <BadgeCheck className="w-3 h-3" />}
        {verificationCopy(field.verificationStatus)}
      </span>
    </div>
  );
}

function PersonCardView({
  person: p,
  unlocking,
  saving,
  onUnlock,
  onSave,
}: {
  person: PersonCard;
  unlocking: boolean;
  saving: boolean;
  onUnlock: () => void;
  onSave: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<PersonDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const assertion = assertionCopy(p.verification.assertion);
  const unlocked = p.contacts.isUnlocked;
  const hasContact = p.contacts.email.available || p.contacts.phone.available || p.contacts.mobile.available || p.contacts.linkedin.available;

  const toggleProfile = async () => {
    const next = !open;
    setOpen(next);
    if (next && !detail) {
      setDetailLoading(true);
      try {
        setDetail((await apiClient.people.get(p.id)) as PersonDetail);
      } catch {
        setDetail({ error: true });
      } finally {
        setDetailLoading(false);
      }
    }
  };

  const otherCompanies = useMemo(
    () => (detail?.roles ?? []).filter((r) => r.businessId !== p.businessId),
    [detail, p.businessId],
  );

  return (
    <article className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 flex items-center justify-center text-xs font-bold text-zinc-700 dark:text-zinc-200 shrink-0">
          {personInitials(p.fullName)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{p.fullName}</h3>
            {!p.isCurrent && (
              <span className="text-[11px] rounded-full border border-zinc-300 dark:border-zinc-700 px-2 py-0.5 text-zinc-500">Former</span>
            )}
          </div>
          <p className="text-xs text-zinc-600 dark:text-zinc-400">{p.jobTitle}</p>
          {p.additionalRoles.length > 0 && (
            <p className="text-[11px] text-zinc-500">Also: {p.additionalRoles.join(' · ')}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
            <span className="rounded-md bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-2 py-0.5 text-zinc-700 dark:text-zinc-300">{p.department.label}</span>
            <span className="rounded-md bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-2 py-0.5 text-zinc-700 dark:text-zinc-300">{p.seniority.label}</span>
            {p.decisionMaker && (
              <span
                title={assertion.hint}
                className={cn(
                  'inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-semibold border',
                  p.verification.assertion === 'KNOWN' && 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 border-transparent',
                  p.verification.assertion === 'LIKELY' && 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 border-zinc-300 dark:border-zinc-700',
                  p.verification.assertion === 'UNVERIFIED' && 'border-dashed border-zinc-400 text-zinc-600 dark:text-zinc-400',
                )}
              >
                {p.verification.assertion === 'KNOWN' && <ShieldCheck className="w-3 h-3" />}
                {p.decisionMaker.claim}
              </span>
            )}
          </div>
        </div>
        <div className="text-right shrink-0 text-[11px] text-zinc-500 space-y-0.5">
          <div className="font-semibold text-zinc-800 dark:text-zinc-200">{assertion.label}</div>
          <div>Confidence: {confidenceCopy(p.verification.confidence.level)}</div>
          <div>Verified: {lastVerifiedCopy(p.verification.lastVerifiedAt)}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 rounded-lg bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-100 dark:border-zinc-800 p-3">
        <ContactRow icon={Linkedin} label="LinkedIn" field={p.contacts.linkedin} unlocked={unlocked} />
        <ContactRow icon={Mail} label="Email" field={p.contacts.email} unlocked={unlocked} />
        <ContactRow icon={Phone} label="Phone" field={p.contacts.phone} unlocked={unlocked} />
        <ContactRow icon={Smartphone} label="Mobile" field={p.contacts.mobile} unlocked={unlocked} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-zinc-500 max-w-md">{p.relevance}</p>
        <div className="flex items-center gap-2">
          <button onClick={toggleProfile} className="px-3 h-8 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs font-semibold hover:bg-zinc-50 dark:hover:bg-zinc-900 cursor-pointer">
            {open ? 'Hide profile' : 'View profile'}
          </button>
          <button
            onClick={onSave}
            disabled={p.isSaved || saving}
            aria-label={p.isSaved ? 'Saved' : 'Save person'}
            className="inline-flex items-center gap-1 px-3 h-8 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs font-semibold hover:bg-zinc-50 dark:hover:bg-zinc-900 disabled:opacity-60 cursor-pointer"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : p.isSaved ? <BookmarkCheck className="w-3.5 h-3.5" /> : <Bookmark className="w-3.5 h-3.5" />}
            {p.isSaved ? 'Saved' : 'Save'}
          </button>
          {unlocked ? (
            <span className="inline-flex items-center gap-1 px-3 h-8 rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-xs font-semibold">
              <LockOpen className="w-3.5 h-3.5" /> Unlocked
            </span>
          ) : (
            <button
              onClick={onUnlock}
              disabled={unlocking || !hasContact}
              title={hasContact ? undefined : 'No contact details published for this person yet'}
              className="inline-flex items-center gap-1 px-3 h-8 rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-xs font-semibold disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
            >
              {unlocking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Lock className="w-3.5 h-3.5" />}
              Unlock contact ({p.unlockCostCredits})
            </button>
          )}
        </div>
      </div>

      {open && (
        <div className="border-t border-zinc-100 dark:border-zinc-800 pt-3 space-y-2 text-xs text-zinc-600 dark:text-zinc-400">
          {detailLoading && <div className="flex items-center"><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Loading profile...</div>}
          {detail?.error && <p>Could not load the full profile.</p>}
          <p className="flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5" />
            {[p.location.city, p.location.state, p.location.country].filter(Boolean).join(', ') || 'Location not on record'}
          </p>
          <p>
            Evidence: {p.evidence.count === 0
              ? 'none on record for this role'
              : `${p.evidence.verifiedCount} of ${p.evidence.count} source${p.evidence.count === 1 ? '' : 's'} verified`}
          </p>
          <p>Status: {verificationCopy(p.verification.status)} · Confidence score {p.verification.confidence.score}/100</p>
          {p.startDate && <p>Since {p.startDate}{p.endDate ? ` until ${p.endDate}` : ''}</p>}
          {otherCompanies.length > 0 && (
            <div>
              <p className="font-semibold text-zinc-800 dark:text-zinc-200">Other companies</p>
              <ul className="list-disc ml-4">
                {otherCompanies.map((r) => (
                  <li key={`${r.businessId}:${r.jobTitle}`}>{r.jobTitle}{r.business?.name ? ` at ${r.business.name}` : ''}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
