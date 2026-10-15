'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, PackageCheck, Upload, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  BUNDLE_STATUS_LABELS,
  ImportApiError,
  PART_STATUS_LABELS,
  bundleProgressPercent,
  bundleReconciliationRows,
  bundleSummaryItems,
  bytesToBase64,
  fetchBundle,
  forgetActiveBundle,
  isTerminal,
  pollBundle,
  recallActiveBundle,
  rememberActiveBundle,
  submitBundle,
  validateBundle,
  validateBundleFile,
} from '@/lib/people-import';
import type { BundlePartStatus, BundleResult, BundleSummary, ImportRequest, ImportStatus } from '@/lib/people-import';

/**
 * Pipeline bundle import (admin only): the ZIP the People Pipeline's split export produces, imported part by part through the
 * existing People import. The ZIP is validated first (nothing is imported unless the whole bundle checks out), then every part is
 * queued in manifest order as an ordinary People import. Like the rest of this screen it shows statuses, counts and references
 * only: what it may show is decided by `toBundleSummary` / `toBundleResult` in @/lib/people-import.
 */
const pill = 'inline-flex items-center rounded-full border border-zinc-200 dark:border-zinc-700 px-2 py-0.5 text-[11px] font-medium';
const btn = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 px-3 h-8 text-xs font-semibold hover:bg-zinc-50 dark:hover:bg-zinc-900 disabled:opacity-50 disabled:cursor-not-allowed';
const STATUS_STYLE: Record<BundlePartStatus, string> = {
  QUEUED: 'text-zinc-600 border-zinc-300',
  RUNNING: 'text-blue-700 border-blue-300',
  COMPLETED: 'text-emerald-700 border-emerald-300',
  COMPLETED_WITH_ISSUES: 'text-amber-700 border-amber-300',
  DRY_RUN: 'text-violet-700 border-violet-300',
  FAILED: 'text-red-700 border-red-300',
  NOT_QUEUED: 'text-red-700 border-red-300',
};
const when = (v: string | null) => (v ? new Date(v).toLocaleString() : '-');

interface Props {
  request: ImportRequest;
  /** Called when a bundle import has finished, so the import history can refresh. */
  onFinished?: () => void;
}

export function PeopleBundleImport({ request, onFinished }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [dryRun, setDryRun] = useState(true);
  const [busy, setBusy] = useState<'validating' | 'importing' | null>(null);
  const [summary, setSummary] = useState<BundleSummary | null>(null);
  const [result, setResult] = useState<BundleResult | null>(null);
  const [tracking, setTracking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const ctl = useRef({ run: 0, alive: true });
  const finishedRef = useRef(onFinished); // keeps `follow` stable when the parent re-renders
  useEffect(() => { finishedRef.current = onFinished; });

  const readBase64 = async (f: File) => bytesToBase64(new Uint8Array(await f.arrayBuffer()));

  const follow = useCallback(async (bundleImportId: string) => {
    const mine = ++ctl.current.run;
    setTracking(true);
    const out = await pollBundle((id) => fetchBundle(request, id), bundleImportId, {
      onUpdate: (b) => { if (ctl.current.run === mine && ctl.current.alive) setResult(b); },
      shouldStop: () => ctl.current.run !== mine || !ctl.current.alive,
    });
    if (ctl.current.run !== mine || !ctl.current.alive) return;
    setTracking(false);
    if (out.reason === 'terminal') {
      forgetActiveBundle(typeof window !== 'undefined' ? window.sessionStorage : null);
      if (out.bundle.status === 'FAILED') toast.error('Not every part of the bundle was imported. The result shows which.');
      else toast.success(out.bundle.dryRun ? 'Bundle dry run finished. Nothing was written.' : 'Bundle import finished.');
      finishedRef.current?.();
    } else if (out.reason === 'error') {
      setError(out.error.message);
    } else if (out.reason === 'max') {
      setError('This bundle import is taking longer than expected. Reload the page later to check on it.');
    }
  }, [request]);

  // resume a bundle import after a reload
  useEffect(() => {
    const c = ctl.current;
    c.alive = true;
    const remembered = recallActiveBundle(typeof window !== 'undefined' ? window.sessionStorage : null);
    if (remembered) {
      fetchBundle(request, remembered)
        .then((b) => {
          if (!c.alive) return;
          setResult(b);
          if (isTerminal(b.status)) forgetActiveBundle(window.sessionStorage);
          else follow(b.bundleImportId);
        })
        .catch(() => forgetActiveBundle(typeof window !== 'undefined' ? window.sessionStorage : null));
    }
    return () => { c.alive = false; c.run++; };
  }, [request, follow]);

  const choose = (f: File | null) => {
    setFile(f);
    setSummary(null);
    setError(null);
  };

  const validate = async () => {
    setError(null);
    setSummary(null);
    const problem = validateBundleFile(file);
    if (problem || !file) { setError(problem ?? 'Choose the People Pipeline bundle (a .zip file).'); return; }
    setBusy('validating');
    try {
      setSummary(await validateBundle(request, await readBase64(file)));
    } catch (e) {
      setError(e instanceof ImportApiError ? e.message : 'The file could not be read.');
    } finally {
      setBusy(null);
    }
  };

  const start = async () => {
    if (!file || !summary) return;
    setError(null);
    setBusy('importing');
    try {
      const accepted = await submitBundle(request, { content: await readBase64(file), dryRun });
      rememberActiveBundle(typeof window !== 'undefined' ? window.sessionStorage : null, accepted.bundleImportId);
      setFile(null);
      setSummary(null);
      if (fileInput.current) fileInput.current.value = '';
      setResult(null);
      toast.success(dryRun ? 'Bundle dry run queued.' : 'Bundle import queued.');
      follow(accepted.bundleImportId);
    } catch (e) {
      setError(e instanceof ImportApiError ? e.message : 'The file could not be read.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-3" aria-label="Pipeline bundle">
        <h3 className="text-sm font-bold flex items-center gap-1.5"><PackageCheck className="w-4 h-4" /> Pipeline bundle</h3>
        <p className="text-xs text-zinc-500">
          The .zip from the People Pipeline&apos;s split export. It is checked as a whole first; nothing is imported unless every part matches its manifest.
          Parts are then imported in order through the same People import as a single file.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileInput}
            type="file"
            accept=".zip,application/zip"
            aria-label="Pipeline bundle file"
            className="text-xs"
            disabled={busy !== null}
            onChange={(e) => choose(e.target.files?.[0] ?? null)}
          />
          <button className={btn} disabled={busy !== null || tracking || !file} onClick={validate}>
            {busy === 'validating' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
            Validate bundle
          </button>
        </div>
        {error && <p role="alert" className="flex items-start gap-1.5 text-xs text-red-600"><XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />{error}</p>}
        {summary && (
          <div className="space-y-3 rounded-lg border border-emerald-200 dark:border-emerald-900 p-3" aria-label="Validated bundle">
            <p className="text-xs flex items-center gap-1.5 text-emerald-700"><CheckCircle2 className="w-3.5 h-3.5" /> The bundle is valid. Nothing has been imported yet.</p>
            <dl className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
              {[
                ['Bundle', summary.bundleId],
                ['Format', summary.format.toUpperCase()],
                ['Parts', String(summary.partCount)],
                ['Rows', summary.totalRows.toLocaleString('en-US')],
                ['Exported', when(summary.exportedAt)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-2">
                  <dt className="text-[11px] text-zinc-500">{label}</dt>
                  <dd className="text-sm font-bold break-all">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1.5 text-xs">
                <input type="checkbox" checked={dryRun} disabled={busy !== null} onChange={(e) => setDryRun(e.target.checked)} />
                Dry run (match companies, write nothing)
              </label>
              <button className={cn(btn, 'bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900')} disabled={busy !== null || tracking} onClick={start}>
                {busy === 'importing' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                {dryRun ? 'Dry-run bundle' : 'Import bundle'}
              </button>
            </div>
          </div>
        )}
      </section>

      {result && (
        <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-3" aria-live="polite" aria-label="Bundle import result">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-bold">
              {result.status === 'QUEUED' || result.status === 'RUNNING' ? 'Bundle import running' : result.dryRun ? 'Bundle dry run' : 'Bundle import'}
            </h3>
            <span className={cn(pill, STATUS_STYLE[result.status])}>{BUNDLE_STATUS_LABELS[result.status as ImportStatus]}</span>
            {(result.status === 'QUEUED' || result.status === 'RUNNING') && <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-500" />}
            {result.status === 'FAILED' && <AlertTriangle className="w-3.5 h-3.5 text-red-600" />}
            {(result.status === 'COMPLETED' || result.status === 'DRY_RUN') && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}
          </div>
          <p className="text-[11px] text-zinc-500">
            Bundle {result.bundleId} · {result.format.toUpperCase()} · exported {when(result.exportedAt)} · imported {when(result.importedAt)}
            {result.completedAt ? ` · finished ${when(result.completedAt)}` : ''}
          </p>
          <div className="h-2 w-full rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={bundleProgressPercent(result)}>
            <div className={cn('h-full transition-all', result.status === 'FAILED' ? 'bg-red-500' : 'bg-emerald-500')} style={{ width: `${bundleProgressPercent(result)}%` }} />
          </div>
          {result.status === 'FAILED' && (
            <p className="text-xs text-red-700">
              Not every part was imported
              {result.failedParts.length ? ` (failed: part ${result.failedParts.join(', ')})` : ''}
              {result.notImportedParts.length ? ` (never queued: part ${result.notImportedParts.join(', ')})` : ''}.
              The counts show what was written. Importing the same bundle again continues safely: people already imported are not duplicated.
            </p>
          )}
          {result.status === 'DRY_RUN' && <p className="text-xs text-violet-700">Nothing was written. These are the outcomes a real import of this bundle would have.</p>}
          <dl className="grid grid-cols-2 md:grid-cols-6 gap-2 text-xs">
            {bundleSummaryItems(result).map((i) => (
              <div key={i.label} className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-2">
                <dt className="text-[11px] text-zinc-500">{i.label}</dt>
                <dd className="text-sm font-bold">{i.value}</dd>
              </div>
            ))}
          </dl>

          <div className="space-y-1">
            <h4 className="text-[11px] uppercase tracking-wider font-bold text-zinc-500">
              Reconciliation {result.reconciliation.balanced ? '· every manifest row has an outcome' : '· not every manifest row has an outcome yet'}
            </h4>
            <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
              <table className="w-full text-xs" aria-label="Bundle reconciliation">
                <thead className="bg-zinc-50 dark:bg-zinc-900 text-left text-zinc-500"><tr><th className="px-3 py-2 font-semibold">Metric</th><th className="px-3 py-2 font-semibold">Manifest</th><th className="px-3 py-2 font-semibold">Orion</th></tr></thead>
                <tbody>
                  {bundleReconciliationRows(result).map((r) => (
                    <tr key={r.metric} className="border-t border-zinc-100 dark:border-zinc-800"><td className="px-3 py-2">{r.metric}</td><td className="px-3 py-2">{r.manifest}</td><td className="px-3 py-2">{r.orion}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-1">
            <h4 className="text-[11px] uppercase tracking-wider font-bold text-zinc-500">Parts</h4>
            <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
              <table className="w-full text-xs" aria-label="Bundle parts">
                <thead className="bg-zinc-50 dark:bg-zinc-900 text-left text-zinc-500">
                  <tr>{['Part', 'File', 'Status', 'Rows', result.dryRun ? 'Would import' : 'Imported', 'Updated', 'Unchanged', 'Quarantined', 'Rejected', 'Run'].map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {result.parts.map((p) => (
                    <tr key={p.partNumber} className="border-t border-zinc-100 dark:border-zinc-800 align-top">
                      <td className="px-3 py-2">{p.partNumber}</td>
                      <td className="px-3 py-2 break-all">{p.filename || '-'}</td>
                      <td className="px-3 py-2"><span className={cn(pill, STATUS_STYLE[p.status])}>{PART_STATUS_LABELS[p.status]}</span>{p.errorSummary && <p className="mt-1 text-[11px] text-red-700">{p.errorSummary}</p>}</td>
                      <td className="px-3 py-2">{p.status === 'NOT_QUEUED' ? '-' : `${p.totalRows}`}</td>
                      <td className="px-3 py-2">{result.dryRun ? p.valid : p.imported}</td>
                      <td className="px-3 py-2">{result.dryRun ? '-' : p.updated}</td>
                      <td className="px-3 py-2">{result.dryRun ? '-' : p.unchanged}</td>
                      <td className="px-3 py-2">{p.quarantined}</td>
                      <td className="px-3 py-2">{p.rejected}</td>
                      <td className="px-3 py-2 break-all text-[11px] text-zinc-500">{p.runRef ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(result.parts.some((p) => p.quarantined > 0) || result.parts.some((p) => p.rejected > 0)) && (
              <p className="text-[11px] text-zinc-500">Quarantined people are resolved in People Review.</p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
