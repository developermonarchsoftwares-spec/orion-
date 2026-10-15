'use client';
/* eslint-disable @typescript-eslint/no-explicit-any -- internal admin view over loosely-typed operations payloads */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, ShieldCheck, X } from 'lucide-react';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api-client';
import { cn } from '@/lib/utils';

import { getAdminAccessToken, ADMIN_SESSION_EXPIRED_EVENT } from '@/lib/admin-fetch';

/**
 * Upload operations (admin only). Talks only to /admin/import/operations/*. It shows counts, statuses and reason codes: the API
 * never returns raw row payloads or personal data. Reprocessing re-runs the existing People stage for errored rows only; rejected
 * and quarantined people are handled in People Review.
 */

interface Pagination { page: number; limit: number; totalItems: number; totalPages: number }
const BASE = '/admin/import/operations';

async function call(method: string, path: string, body?: unknown): Promise<any> {
  const token = getAdminAccessToken() || apiClient.getAccessToken();
  const res = await fetch(`${apiClient.getBaseUrl()}${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(ADMIN_SESSION_EXPIRED_EVENT));
      }
      throw new Error('Your administrator session has expired or is invalid. Please sign in again.');
    }
    const msg = Array.isArray(json?.message) ? json.message.join(', ') : json?.message || `Request failed (${res.status})`;
    throw new Error(res.status === 403 ? 'You do not have permission to do this. Administrator privileges (ADMIN or SUPER_ADMIN) are required.' : msg);
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
const OUTCOME_STYLE: Record<string, string> = { FAILED: 'text-red-700 border-red-300', COMPLETED_WITH_ISSUES: 'text-amber-700 border-amber-300', IN_PROGRESS: 'text-zinc-500', COMPLETED: '' };

export function UploadOperationsView() {
  const [f, setF] = useState({ status: 'ALL', q: '', from: '', to: '', hasIssues: '', page: '1' });
  const [rows, setRows] = useState<any[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v, page: k === 'page' ? v : '1' }));

  useEffect(() => {
    let cancelled = false;
    call('GET', `/batches?${qs({ status: f.status, q: f.q || undefined, from: f.from ? new Date(f.from).toISOString() : undefined, to: f.to ? new Date(`${f.to}T23:59:59`).toISOString() : undefined, hasIssues: f.hasIssues || undefined, page: f.page, limit: '20' })}`)
      .then((r) => { if (!cancelled) { setRows(r.data); setPagination(r.pagination); setError(null); } })
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [f, reload]);

  return (
    <div className="space-y-3 p-1">
      <p className="text-xs text-zinc-500 flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5" /> Counts, statuses and reason codes only. Raw rows and personal data are never shown here.</p>
      <div className="flex flex-wrap gap-2 items-center">
        <select className={input} value={f.status} onChange={(e) => set('status', e.target.value)} aria-label="Status">
          {['ALL', 'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'].map((s) => <option key={s}>{s}</option>)}
        </select>
        <select className={input} value={f.hasIssues} onChange={(e) => set('hasIssues', e.target.value)} aria-label="Issues">
          <option value="">Any outcome</option><option value="true">With issues</option><option value="false">Clean</option>
        </select>
        <input className={input} placeholder="File name" value={f.q} onChange={(e) => set('q', e.target.value)} />
        <label className="text-xs text-zinc-500 flex items-center gap-1">From <input type="date" className={input} value={f.from} onChange={(e) => set('from', e.target.value)} /></label>
        <label className="text-xs text-zinc-500 flex items-center gap-1">To <input type="date" className={input} value={f.to} onChange={(e) => set('to', e.target.value)} /></label>
      </div>
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : error ? <p className="text-xs text-red-600">{error}</p> : rows.length === 0 ? <p className="py-8 text-center text-xs text-zinc-500">No upload batches match.</p> : (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-xs">
            <thead className="bg-zinc-50 dark:bg-zinc-900 text-left text-zinc-500">
              <tr>{['File', 'Created', 'Source', 'Status', 'Rows', 'Accepted', 'Rejected', 'Duplicate', 'People created / updated / skipped', 'People quarantined / rejected / errors'].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id} onClick={() => setOpenId(b.id)} className="border-t border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 cursor-pointer">
                  <td className="px-3 py-2 font-semibold">{b.filename}</td>
                  <td className="px-3 py-2">{new Date(b.createdAt).toLocaleString()}</td>
                  <td className="px-3 py-2">{b.source?.name ?? b.source?.type}</td>
                  <td className="px-3 py-2"><span className={cn(pill, OUTCOME_STYLE[b.outcome])}>{b.outcome.replace(/_/g, ' ')}</span></td>
                  <td className="px-3 py-2">{b.rows.processed}/{b.rows.total}</td>
                  <td className="px-3 py-2">{b.rows.accepted}</td>
                  <td className="px-3 py-2">{b.rows.rejected}</td>
                  <td className="px-3 py-2">{b.rows.duplicate}</td>
                  <td className="px-3 py-2">{b.people ? `${b.people.created} / ${b.people.updated} / ${b.people.skipped}` : '-'}</td>
                  <td className="px-3 py-2">{b.people ? `${b.people.quarantined} / ${b.people.rejected} / ${b.people.errors}` : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span>Page {pagination.page} of {pagination.totalPages} · {pagination.totalItems} batches</span>
          <div className="flex gap-2">
            <button className={btn} disabled={pagination.page <= 1} onClick={() => set('page', String(pagination.page - 1))}>Previous</button>
            <button className={btn} disabled={pagination.page >= pagination.totalPages} onClick={() => set('page', String(pagination.page + 1))}>Next</button>
          </div>
        </div>
      )}
      {openId && <BatchDrawer id={openId} onClose={() => setOpenId(null)} onChanged={() => setReload((n) => n + 1)} />}
    </div>
  );
}

function BatchDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState('ALL');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => call('GET', `/batches/${id}?${qs({ status, page: String(page), limit: '50' })}`).then((r) => { setD(r.data); setErr(null); }).catch((e: Error) => setErr(e.message)), [id, status, page]);
  useEffect(() => { load(); }, [load]);

  const reprocess = async () => {
    setBusy(true);
    try {
      const r = await call('POST', `/batches/${id}/reprocess-people`);
      const o = r.data;
      toast.success(`Reprocessed ${o.reprocessed} of ${o.candidates} errored row(s)${o.stillFailing ? `; ${o.stillFailing} still failing` : ''}`);
      await load();
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div className="w-full max-w-3xl h-full overflow-y-auto bg-white dark:bg-zinc-950 p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold">{d?.batch.filename ?? 'Batch'}</h3>
          <button className={btn} onClick={onClose} aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        {err ? <p className="text-xs text-red-600">{err}</p> : !d ? <Loader2 className="w-4 h-4 animate-spin" /> : (
          <>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className={cn(pill, OUTCOME_STYLE[d.batch.outcome])}>{d.batch.outcome.replace(/_/g, ' ')}</span>
              <span className={pill}>{d.batch.rows.total} rows</span>
              <span className={pill}>accepted {d.batch.rows.accepted}</span>
              <span className={pill}>rejected {d.batch.rows.rejected}</span>
              <span className={pill}>duplicate {d.batch.rows.duplicate}</span>
              {d.batch.people && <span className={pill}>people: created {d.batch.people.created}, updated {d.batch.people.updated}, skipped {d.batch.people.skipped}, quarantined {d.batch.people.quarantined}, rejected {d.batch.people.rejected}, errors {d.batch.people.errors}</span>}
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <button className={btn} disabled={busy || !(d.batch.people?.errors > 0)} onClick={reprocess}>Reprocess errored People rows</button>
              <span className="text-[11px] text-zinc-500">Rejected / quarantined people are resolved in People Review; failed company rows are re-published from the publish queue.</span>
            </div>
            {(d.reasonCodes.people.length > 0 || d.reasonCodes.validation.length > 0) && (
              <div className="space-y-1 text-xs">
                <h4 className="text-[11px] uppercase tracking-wider font-bold text-zinc-500">Reason codes</h4>
                {d.reasonCodes.people.map((c: any) => <div key={c.code}><span className={pill}>{c.code}</span> × {c.count}</div>)}
                {d.reasonCodes.validation.map((c: any) => <div key={`${c.rule}:${c.field}`}><span className={pill}>{c.rule}</span> {c.field} ({c.severity}) × {c.count}</div>)}
              </div>
            )}
            <div className="flex gap-2 items-center">
              <select className={input} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Row status">
                {['ALL', 'PUBLISHED', 'FAILED', 'FLAGGED_DUPLICATE', 'NEEDS_REVIEW', 'REJECTED', 'APPROVED'].map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <table className="w-full text-xs">
              <thead className="bg-zinc-50 dark:bg-zinc-900 text-left text-zinc-500"><tr>{['Row', 'Company', 'Business', 'Status', 'Publish', 'Validation', 'People outcome'].map((h) => <th key={h} className="px-2 py-1.5">{h}</th>)}</tr></thead>
              <tbody>
                {d.records.map((r: any) => (
                  <tr key={r.id} className="border-t border-zinc-100 dark:border-zinc-800 align-top">
                    <td className="px-2 py-1.5">{r.rowNumber}</td>
                    <td className="px-2 py-1.5">{r.companyName ?? '-'}</td>
                    <td className="px-2 py-1.5 font-mono text-[10px]">{r.businessId ? String(r.businessId).slice(0, 8) : '-'}</td>
                    <td className="px-2 py-1.5"><span className={pill}>{r.status}</span></td>
                    <td className="px-2 py-1.5">{r.publish ? `${r.publish.status}${r.publish.retries ? ` (${r.publish.retries} retries)` : ''}` : '-'}</td>
                    <td className="px-2 py-1.5">{r.validationFailures.map((v: any) => `${v.rule}:${v.field}`).join(', ') || '-'}</td>
                    <td className="px-2 py-1.5">
                      {r.people ? (r.people.failed ? <span className="text-red-600">failed</span> : r.people.outcomes.map((o: any) => <div key={o.index}>{o.outcome}{o.codes.length ? ` (${o.codes.join(', ')})` : ''}</div>)) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {d.pagination.totalPages > 1 && (
              <div className="flex gap-2 text-xs items-center">
                <button className={btn} disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
                <span>Page {d.pagination.page} / {d.pagination.totalPages}</span>
                <button className={btn} disabled={page >= d.pagination.totalPages} onClick={() => setPage(page + 1)}>Next</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
