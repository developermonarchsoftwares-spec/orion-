'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, ShieldCheck, Upload, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import {
  HISTORY_PAGE_SIZE,
  ImportApiError,
  PEOPLE_IMPORT_MAX_ROWS,
  STATUS_LABELS,
  describeFailure,
  detectFormat,
  fetchHistory,
  fetchJob,
  forgetActiveJob,
  isTerminal,
  jobSummary,
  pollImportJob,
  progressPercent,
  recallActiveJob,
  rememberActiveJob,
  submitImport,
  validateFile,
} from '@/lib/people-import';
import type { ImportHistory, ImportJob, ImportRequest, ImportStatus } from '@/lib/people-import';
import { PeopleBundleImport } from './people-bundle-import';

import { getAdminAccessToken, ADMIN_SESSION_EXPIRED_EVENT } from '@/lib/admin-fetch';

/**
 * People import (admin only). Upload the People Pipeline export (CSV or JSON), optionally as a dry run, then follow the background
 * job to its end. It talks only to /admin/people/import. It shows statuses, counts and reason codes: what it may show is decided by
 * `toImportJob` in @/lib/people-import, so names, contact details, rows, file contents, hashes and internal references cannot reach
 * this screen. The file is read in the browser only to be sent once; it is never displayed or kept.
 */

const request: ImportRequest = async (method, path, body) => {
  const token = getAdminAccessToken() || apiClient.getAccessToken();
  const res = await fetch(`${apiClient.getBaseUrl()}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401 && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(ADMIN_SESSION_EXPIRED_EVENT));
  }
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
};

const pill = 'inline-flex items-center rounded-full border border-zinc-200 dark:border-zinc-700 px-2 py-0.5 text-[11px] font-medium';
const btn = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 px-3 h-8 text-xs font-semibold hover:bg-zinc-50 dark:hover:bg-zinc-900 disabled:opacity-50 disabled:cursor-not-allowed';
const STATUS_STYLE: Record<ImportStatus, string> = {
  QUEUED: 'text-zinc-600 border-zinc-300',
  RUNNING: 'text-blue-700 border-blue-300',
  COMPLETED: 'text-emerald-700 border-emerald-300',
  COMPLETED_WITH_ISSUES: 'text-amber-700 border-amber-300',
  DRY_RUN: 'text-violet-700 border-violet-300',
  FAILED: 'text-red-700 border-red-300',
};

const when = (v: string | null) => (v ? new Date(v).toLocaleString() : '-');

export function PeopleImportView() {
  const [file, setFile] = useState<File | null>(null);
  const [dryRun, setDryRun] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [job, setJob] = useState<ImportJob | null>(null);
  const [tracking, setTracking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<ImportHistory | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [page, setPage] = useState(1);
  const fileInput = useRef<HTMLInputElement>(null);
  // `run` identifies the job currently being followed (any change stops the older poll); `alive` is false once the screen is gone
  const ctl = useRef({ run: 0, alive: true });

  const loadHistory = useCallback(async (p: number) => {
    setHistoryLoading(true);
    try {
      const h = await fetchHistory(request, p, HISTORY_PAGE_SIZE);
      if (ctl.current.alive) { setHistory(h); setHistoryError(null); }
    } catch (e) {
      if (ctl.current.alive) setHistoryError(e instanceof ImportApiError ? e.message : describeFailure(0, null));
    } finally {
      if (ctl.current.alive) setHistoryLoading(false);
    }
  }, []);

  const onBundleFinished = useCallback(() => { loadHistory(1); setPage(1); }, [loadHistory]);

  const follow = useCallback(async (jobId: string) => {
    const mine = ++ctl.current.run;
    setTracking(true);
    const out = await pollImportJob((id) => fetchJob(request, id), jobId, {
      onUpdate: (j) => { if (ctl.current.run === mine && ctl.current.alive) setJob(j); },
      shouldStop: () => ctl.current.run !== mine || !ctl.current.alive,
    });
    if (ctl.current.run !== mine || !ctl.current.alive) return;
    setTracking(false);
    if (out.reason === 'terminal') {
      forgetActiveJob(typeof window !== 'undefined' ? window.sessionStorage : null);
      if (out.job.status === 'FAILED') toast.error('The import failed. The counts show what was written before it stopped.');
      else toast.success(out.job.dryRun ? 'Dry run finished. Nothing was written.' : 'Import finished.');
      loadHistory(1);
      setPage(1);
    } else if (out.reason === 'error') {
      setError(out.error.message);
    } else if (out.reason === 'max') {
      setError('This import is taking longer than expected. Use Refresh to check on it later.');
    }
  }, [loadHistory]);

  // first load, and resuming a job after a reload
  useEffect(() => {
    const c = ctl.current;
    c.alive = true;
    fetchHistory(request, 1, HISTORY_PAGE_SIZE)
      .then((h) => { if (c.alive) { setHistory(h); setHistoryError(null); } })
      .catch((e) => { if (c.alive) setHistoryError(e instanceof ImportApiError ? e.message : describeFailure(0, null)); })
      .finally(() => { if (c.alive) setHistoryLoading(false); });
    const remembered = recallActiveJob(typeof window !== 'undefined' ? window.sessionStorage : null);
    if (remembered) {
      fetchJob(request, remembered)
        .then((j) => {
          if (!c.alive) return;
          setJob(j);
          if (isTerminal(j.status)) forgetActiveJob(window.sessionStorage);
          else follow(j.jobId);
        })
        .catch(() => forgetActiveJob(typeof window !== 'undefined' ? window.sessionStorage : null));
    }
    return () => { c.alive = false; c.run++; };
  }, [follow]);

  const start = async () => {
    setError(null);
    const problem = validateFile(file);
    if (problem || !file) { setError(problem ?? 'Choose the People export file (CSV or JSON).'); return; }
    const format = detectFormat(file.name);
    if (!format) return;
    setSubmitting(true);
    try {
      const content = await file.text();
      const accepted = await submitImport(request, { format, content, dryRun });
      rememberActiveJob(typeof window !== 'undefined' ? window.sessionStorage : null, accepted.jobId);
      setFile(null);
      if (fileInput.current) fileInput.current.value = '';
      setJob(null);
      toast.success(accepted.dryRun ? 'Dry run queued.' : 'Import queued.');
      follow(accepted.jobId);
    } catch (e) {
      setError(e instanceof ImportApiError ? e.message : 'The file could not be read.');
    } finally {
      setSubmitting(false);
    }
  };

  const open = (j: ImportJob) => {
    setError(null);
    setJob(j);
    if (isTerminal(j.status)) { ctl.current.run++; setTracking(false); } else follow(j.jobId);
  };

  const refresh = async () => {
    setError(null);
    loadHistory(page);
    if (job) {
      try {
        const j = await fetchJob(request, job.jobId);
        setJob(j);
        if (!isTerminal(j.status) && !tracking) follow(j.jobId);
      } catch (e) {
        setError(e instanceof ImportApiError ? e.message : describeFailure(0, null));
      }
    }
  };

  return (
    <div className="space-y-4 p-1">
      <p className="text-xs text-zinc-500 flex items-center gap-1">
        <ShieldCheck className="w-3.5 h-3.5" /> Statuses, counts and reason codes only. Names, contact details, rows and file contents are never shown here.
      </p>

      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-3">
        <h3 className="text-sm font-bold">Import a People Pipeline export</h3>
        <p className="text-xs text-zinc-500">
          CSV or JSON, up to {PEOPLE_IMPORT_MAX_ROWS.toLocaleString('en-US')} rows. People are matched to companies that already exist; no company is created.
          Imported people start as drafts and wait in People Review: nothing is verified or published by an import.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileInput}
            type="file"
            accept=".csv,.json,text/csv,application/json"
            aria-label="People export file"
            className="text-xs"
            disabled={submitting}
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(null); }}
          />
          <label className="flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={dryRun} disabled={submitting} onChange={(e) => setDryRun(e.target.checked)} />
            Dry run (validate and match companies, write nothing)
          </label>
          <button className={cn(btn, 'bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900')} disabled={submitting || tracking || !file} onClick={start}>
            {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            {dryRun ? 'Start dry run' : 'Start import'}
          </button>
        </div>
        {error && <p role="alert" className="flex items-start gap-1.5 text-xs text-red-600"><XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />{error}</p>}
      </section>

      <PeopleBundleImport request={request} onFinished={onBundleFinished} />

      {job && (
        <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-3" aria-live="polite">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-bold">{job.dryRun ? 'Dry run' : 'Import'}</h3>
            <span className={cn(pill, STATUS_STYLE[job.status])}>{STATUS_LABELS[job.status]}</span>
            {(job.status === 'QUEUED' || job.status === 'RUNNING') && <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-500" />}
            {job.status === 'FAILED' && <AlertTriangle className="w-3.5 h-3.5 text-red-600" />}
            {(job.status === 'COMPLETED' || job.status === 'DRY_RUN') && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}
            <span className="text-[11px] text-zinc-500">Started {when(job.createdAt)}{job.completedAt ? ` · finished ${when(job.completedAt)}` : ''}</span>
          </div>
          <div className="h-2 w-full rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent(job)}>
            <div className={cn('h-full transition-all', job.status === 'FAILED' ? 'bg-red-500' : 'bg-emerald-500')} style={{ width: `${progressPercent(job)}%` }} />
          </div>
          {job.status === 'FAILED' && (
            <p className="text-xs text-red-700">
              {job.errorSummary ?? 'The import could not be completed.'} The counts below are what was written before it stopped. Importing the same file again continues safely: people already imported are not duplicated.
            </p>
          )}
          {job.dryRun && job.status === 'DRY_RUN' && <p className="text-xs text-violet-700">Nothing was written. These are the outcomes a real import of this file would have.</p>}
          <dl className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
            {jobSummary(job).map((i) => (
              <div key={i.label} className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-2">
                <dt className="text-[11px] text-zinc-500">{i.label}</dt>
                <dd className="text-sm font-bold">{i.value}</dd>
              </div>
            ))}
          </dl>
          {Object.keys(job.reasonCounts).length > 0 && (
            <div className="space-y-1 text-xs">
              <h4 className="text-[11px] uppercase tracking-wider font-bold text-zinc-500">Reason codes</h4>
              <div className="flex flex-wrap gap-2">{Object.entries(job.reasonCounts).map(([code, n]) => <span key={code} className={pill}>{code} × {n}</span>)}</div>
              <p className="text-[11px] text-zinc-500">Quarantined people are resolved in People Review.</p>
            </div>
          )}
          {job.rejectedRows.length > 0 && (
            <div className="space-y-1 text-xs">
              <h4 className="text-[11px] uppercase tracking-wider font-bold text-zinc-500">Rejected rows</h4>
              <div className="flex flex-wrap gap-2">{job.rejectedRows.map((r) => <span key={`${r.row}:${r.code}`} className={pill}>row {r.row}: {r.code}</span>)}</div>
            </div>
          )}
        </section>
      )}

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold">Import history</h3>
          <button className={btn} onClick={refresh} disabled={historyLoading}>
            <RefreshCw className={cn('w-3.5 h-3.5', historyLoading && 'animate-spin')} /> Refresh
          </button>
        </div>
        {historyError ? (
          <p role="alert" className="text-xs text-red-600">{historyError}</p>
        ) : historyLoading && !history ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : !history || history.items.length === 0 ? (
          <p className="py-8 text-center text-xs text-zinc-500">No imports yet. Finished imports are kept for 7 days.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-xs">
              <thead className="bg-zinc-50 dark:bg-zinc-900 text-left text-zinc-500">
                <tr>{['Started', 'Mode', 'Status', 'Rows', 'Imported', 'Unchanged', 'Quarantined', 'Rejected'].map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr>
              </thead>
              <tbody>
                {history.items.map((j) => (
                  <tr key={j.jobId} onClick={() => open(j)} className="border-t border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 cursor-pointer">
                    <td className="px-3 py-2">{when(j.createdAt)}</td>
                    <td className="px-3 py-2">{j.dryRun ? 'Dry run' : 'Import'}</td>
                    <td className="px-3 py-2"><span className={cn(pill, STATUS_STYLE[j.status])}>{STATUS_LABELS[j.status]}</span></td>
                    <td className="px-3 py-2">{j.processedRows}/{j.totalRows}</td>
                    <td className="px-3 py-2">{j.dryRun ? '-' : j.imported}</td>
                    <td className="px-3 py-2">{j.dryRun ? '-' : j.unchanged}</td>
                    <td className="px-3 py-2">{j.quarantined}</td>
                    <td className="px-3 py-2">{j.failed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {history && history.totalPages > 1 && (
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>Page {history.page} of {history.totalPages} · {history.totalItems} imports</span>
            <div className="flex gap-2">
              <button className={btn} disabled={history.page <= 1 || historyLoading} onClick={() => { setPage(history.page - 1); loadHistory(history.page - 1); }}>Previous</button>
              <button className={btn} disabled={history.page >= history.totalPages || historyLoading} onClick={() => { setPage(history.page + 1); loadHistory(history.page + 1); }}>Next</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
