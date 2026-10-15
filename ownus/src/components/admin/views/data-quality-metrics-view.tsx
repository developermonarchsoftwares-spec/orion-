'use client';
/* eslint-disable @typescript-eslint/no-explicit-any -- internal admin view over loosely-typed metrics payloads */

import { useEffect, useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { apiClient } from '@/lib/api-client';

/**
 * Data quality & pipeline metrics (admin only). Talks only to /internal/people-metrics/*. Everything shown is a factual count or a
 * duration derived from existing data: no score, rank or prediction, and no personal data (the API never returns any).
 */

import { getAdminAccessToken, ADMIN_SESSION_EXPIRED_EVENT } from '@/lib/admin-fetch';

const BASE = '/internal/people-metrics';

async function call(path: string): Promise<any> {
  const token = getAdminAccessToken() || apiClient.getAccessToken();
  const res = await fetch(`${apiClient.getBaseUrl()}${BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(ADMIN_SESSION_EXPIRED_EVENT));
      }
      throw new Error('Your administrator session has expired or is invalid. Please sign in again.');
    }
    const msg = Array.isArray(json?.message) ? json.message.join(', ') : json?.message || `Request failed (${res.status})`;
    throw new Error(res.status === 403 ? 'You do not have permission to view metrics. Administrator privileges (ADMIN or SUPER_ADMIN) are required.' : msg);
  }
  return json;
}

const input = 'h-8 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 text-xs';
const btn = 'inline-flex items-center justify-center rounded-lg border border-zinc-200 dark:border-zinc-800 px-3 h-8 text-xs font-semibold hover:bg-zinc-50 dark:hover:bg-zinc-900 disabled:opacity-50 cursor-pointer';

function Card({ title, basis, rows }: { title: string; basis?: string; rows: Array<[string, string | number]> }) {
  return (
    <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3 space-y-1.5">
      <h4 className="text-[11px] uppercase tracking-wider font-bold text-zinc-500">{title}</h4>
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-3 text-xs"><span className="text-zinc-600 dark:text-zinc-400">{k}</span><span className="font-semibold tabular-nums">{v}</span></div>
      ))}
      {basis && <p className="text-[10px] text-zinc-400 pt-1">{basis}</p>}
    </section>
  );
}

const entries = (o: Record<string, number> | undefined): Array<[string, number]> => Object.entries(o ?? {});

export function DataQualityMetricsView() {
  const [range, setRange] = useState({ from: '', to: '' });
  const [m, setM] = useState<any>(null);
  const [problems, setProblems] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const q = new URLSearchParams();
    if (range.from) q.set('from', new Date(range.from).toISOString());
    if (range.to) q.set('to', new Date(`${range.to}T23:59:59`).toISOString());
    const rq = q.toString();
    const pq = new URLSearchParams(q);
    pq.set('page', String(page));
    pq.set('limit', '10');
    Promise.all([call(`/overview${rq ? `?${rq}` : ''}`), call(`/problem-batches?${pq.toString()}`)])
      .then(([o, p]) => { if (!cancelled) { setM(o.data); setProblems({ items: p.data, pagination: p.pagination }); setError(null); } })
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [range, page]);

  return (
    <div className="space-y-4 p-1">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-xs text-zinc-500 flex items-center gap-1">From <input type="date" className={input} value={range.from} onChange={(e) => { setRange((r) => ({ ...r, from: e.target.value })); setPage(1); }} /></label>
        <label className="text-xs text-zinc-500 flex items-center gap-1">To <input type="date" className={input} value={range.to} onChange={(e) => { setRange((r) => ({ ...r, to: e.target.value })); setPage(1); }} /></label>
        <span className="text-xs text-zinc-500 flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5" /> Factual counts only: no scores, no personal data.</span>
      </div>
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : error ? <p className="text-xs text-red-600">{error}</p> : m && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Card title="Acquisition" rows={[['Uploads', m.acquisition.uploads], ['Rows processed', `${m.acquisition.rows.processed} / ${m.acquisition.rows.total}`], ['Accepted', m.acquisition.rows.accepted], ['Rejected', m.acquisition.rows.rejected], ['Duplicates', m.acquisition.rows.duplicates], ['People created', m.acquisition.people.created], ['People updated', m.acquisition.people.updated], ['People skipped', m.acquisition.people.skipped], ['People quarantined', m.acquisition.people.quarantined], ['People rejected', m.acquisition.people.rejected], ['People errors', m.acquisition.people.errors]]} />
            <Card title="Quarantine" rows={[['Total', m.acquisition.quarantine.total], ...entries(m.acquisition.quarantine.byStatus), ...m.acquisition.quarantine.topReasonCodes.slice(0, 6).map((c: any): [string, number] => [c.code, c.count])]} />
            <Card title="Company resolution & identity" basis={m.companyResolution.basis} rows={[['Matched', m.companyResolution.matched], ['Company not found', m.companyResolution.notFound], ['Company ambiguous', m.companyResolution.ambiguous], ['Suppression hits', m.identity.suppressionHits], ['Duplicate identity attempts', m.identity.duplicateIdentityAttempts], ['Suppression registry', m.identity.suppressionRegistry.total]]} />
            <Card title="Contacts" basis={m.contacts.basis} rows={[['People', m.contacts.people], ['With e-mail', m.contacts.withEmail], ['With phone', m.contacts.withPhone], ['With LinkedIn', m.contacts.withLinkedin], ['Missing contacts', m.contacts.missingContacts], ['Open contact conflicts', m.contacts.openContactConflicts]]} />
            <Card title="Review" basis={m.review.basis} rows={[['Roles', m.review.roles], ['Pending', m.review.pending], ['Approved', m.review.approved], ['Rejected', m.review.rejected], ['Quarantined', m.review.quarantined], ['Published', m.review.published]]} />
            <Card title="Verification" basis={m.verification.basis} rows={[['Verified', m.verification.verified], ['Partially verified', m.verification.partiallyVerified], ['Unverified', m.verification.unverified], ['Disputed', m.verification.disputed], [`Stale (> ${m.verification.staleAfterDays} d)`, m.verification.stale]]} />
            <Card title="Classification" basis={m.classification.basis} rows={[['Classified', m.classification.classified], ['Unclassified (UNKNOWN)', m.classification.unclassified], ['Decision makers', m.classification.decisionMakers], ...entries(m.classification.bySource), ...entries(m.classification.byTaxonomyVersion).map(([k, v]): [string, number] => [`taxonomy ${k}`, v])]} />
            <Card title="Open conflicts" basis={m.conflicts.basis} rows={[['Open (all types)', m.conflicts.openTotal], ...entries(m.conflicts.open), ['Resolved', m.conflicts.resolvedTotal]]} />
            <Card title="Pipeline health" rows={[['Failed batches', m.pipelineHealth.failedBatches], ['Batches with People errors', m.pipelineHealth.batchesWithPeopleErrors], ['Failed rows', m.pipelineHealth.failedRows], ['Publish failures', m.pipelineHealth.publishQueue.failed], ['Publish retries', m.pipelineHealth.publishQueue.retries], ['Avg processing (s)', m.pipelineHealth.processingSeconds.average], ['p95 processing (s)', m.pipelineHealth.processingSeconds.p95], ['Max processing (s)', m.pipelineHealth.processingSeconds.max]]} />
          </div>
          <section className="space-y-2">
            <h4 className="text-[11px] uppercase tracking-wider font-bold text-zinc-500">Batches with problems</h4>
            {problems && problems.items.length === 0 ? <p className="text-xs text-zinc-500">None in this range.</p> : (
              <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
                <table className="w-full text-xs">
                  <thead className="bg-zinc-50 dark:bg-zinc-900 text-left text-zinc-500"><tr>{['File', 'Created', 'Status', 'Rows failed / total', 'People errors / rejected / quarantined', 'Duration (s)'].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}</tr></thead>
                  <tbody>
                    {problems?.items.map((b: any) => (
                      <tr key={b.id} className="border-t border-zinc-100 dark:border-zinc-800">
                        <td className="px-3 py-2 font-semibold">{b.filename}</td>
                        <td className="px-3 py-2">{new Date(b.createdAt).toLocaleString()}</td>
                        <td className="px-3 py-2">{b.status}</td>
                        <td className="px-3 py-2">{b.rows.failed} / {b.rows.total}</td>
                        <td className="px-3 py-2">{b.people.errors} / {b.people.rejected} / {b.people.quarantined}</td>
                        <td className="px-3 py-2">{b.durationSeconds ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {problems?.pagination.totalPages > 1 && (
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                <button className={btn} disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
                <span>Page {problems.pagination.page} of {problems.pagination.totalPages}</span>
                <button className={btn} disabled={page >= problems.pagination.totalPages} onClick={() => setPage(page + 1)}>Next</button>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
