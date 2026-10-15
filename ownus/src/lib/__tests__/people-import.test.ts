import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ACTIVE_JOB_KEY,
  ImportApiError,
  PEOPLE_IMPORT_BASE,
  POLL_DELAYS_MS,
  describeFailure,
  detectFormat,
  fetchHistory,
  fetchJob,
  forgetActiveJob,
  isTerminal,
  jobSummary,
  pollDelay,
  pollImportJob,
  progressPercent,
  recallActiveJob,
  rememberActiveJob,
  submitImport,
  toImportJob,
  validateFile,
} from '../people-import.ts';
import { routePolicy } from '../gateway-auth.ts';
import type { ImportJob, ImportRequest } from '../people-import.ts';

const ID = '0d3c4a8e-1111-4222-8333-444455556666';
const OTHER = '9a8b7c6d-1111-4222-8333-444455556666';

const apiJob = (over: Record<string, unknown> = {}) => ({
  jobId: ID, status: 'RUNNING', dryRun: false, totalRows: 100, processedRows: 40, imported: 30, updated: 2, unchanged: 5, valid: 0, quarantined: 3, failed: 0,
  matched: 37, unmatched: 2, ambiguous: 1, reasonCounts: { BUSINESS_NOT_FOUND: 2, AMBIGUOUS_COMPANY_MATCH: 1 }, rejectedRows: [], errorSummary: null,
  createdAt: '2026-10-01T10:00:00.000Z', completedAt: null, ...over,
});
const job = (over: Record<string, unknown> = {}): ImportJob => toImportJob(apiJob(over)) as ImportJob;
const reply = (status: number, body: unknown) => async () => ({ status, body });

describe('people import: what the screen may know about a job', () => {
  it('keeps counts, codes and timestamps and drops everything else', () => {
    const leaky = apiJob({
      fullName: 'Asha Rao', email: 'asha@acme.example', phone: '+919811122233', linkedin_url: 'https://www.linkedin.com/in/asha', rawRow: 'a,b,c',
      content: 'Person Name,Email', storageKey: 'people-imports/x.csv', contentSha256: 'deadbeef', batchRef: 'people-export-v1-abc', requestedBy: ID,
      queuePayload: { storageKey: 'k' }, databaseUrl: 'postgresql://u:p@h/db', token: 'secret',
    });
    const j = toImportJob(leaky) as ImportJob;
    const text = JSON.stringify(j);
    for (const bad of ['Asha', 'acme.example', '9811122233', 'linkedin', 'a,b,c', 'Person Name', 'people-imports', 'deadbeef', 'people-export', 'postgresql', 'secret', 'rawRow']) {
      assert.ok(!text.includes(bad), bad);
    }
    assert.deepEqual(Object.keys(j).sort(), ['ambiguous', 'completedAt', 'createdAt', 'dryRun', 'errorSummary', 'failed', 'imported', 'jobId', 'matched', 'processedRows', 'quarantined', 'reasonCounts', 'rejectedRows', 'status', 'totalRows', 'unchanged', 'unmatched', 'updated', 'valid']);
  });

  it('refuses things that are not a job, and unsafe codes', () => {
    assert.equal(toImportJob(null), null);
    assert.equal(toImportJob({}), null);
    assert.equal(toImportJob(apiJob({ jobId: 'not-a-uuid' })), null);
    assert.equal(toImportJob(apiJob({ status: 'WHATEVER' })), null);
    const j = job({ reasonCounts: { 'Asha Rao': 3, OK_CODE: 2, lower: 1 }, rejectedRows: [{ row: 3, code: 'INVALID_COMPANY_IDENTIFIER' }, { row: 4, code: 'asha@acme.example' }, 'x'] });
    assert.deepEqual(j.reasonCounts, { OK_CODE: 2 });
    assert.deepEqual(j.rejectedRows, [{ row: 3, code: 'INVALID_COMPANY_IDENTIFIER' }]);
  });

  it('coerces counts safely', () => {
    const j = job({ imported: -5, updated: 'x', unchanged: 3.9, quarantined: null });
    assert.equal(j.imported, 0);
    assert.equal(j.updated, 0);
    assert.equal(j.unchanged, 3);
    assert.equal(j.quarantined, 0);
  });

  it('shows the counts the admin asked for, and "would be imported" for a dry run', () => {
    const labels = jobSummary(job()).map((i) => i.label);
    assert.deepEqual(labels, ['Rows processed', 'Imported', 'Updated', 'Unchanged', 'Matched to a company', 'Company not found', 'Company ambiguous', 'Quarantined', 'Rejected rows']);
    assert.equal(jobSummary(job()).find((i) => i.label === 'Rows processed')?.value, '40 of 100');
    const dry = jobSummary(job({ dryRun: true, status: 'DRY_RUN', valid: 7 }));
    assert.equal(dry.find((i) => i.label === 'Would be imported')?.value, '7');
    assert.ok(!dry.some((i) => i.label === 'Imported' || i.label === 'Updated'));
  });

  it('computes progress without dividing by zero', () => {
    assert.equal(progressPercent(job({ totalRows: 0, processedRows: 0 })), 0);
    assert.equal(progressPercent(job({ totalRows: 200, processedRows: 50 })), 25);
    assert.equal(progressPercent(job({ totalRows: 10, processedRows: 99 })), 100);
    assert.equal(progressPercent(job({ status: 'COMPLETED', processedRows: 0 })), 100);
    assert.equal(progressPercent(job({ status: 'FAILED', totalRows: 270, processedRows: 250 })), 93); // a failed job keeps the progress it reached
  });
});

describe('people import: the file', () => {
  it('detects the format from the extension', () => {
    assert.equal(detectFormat('export.csv'), 'csv');
    assert.equal(detectFormat('EXPORT.JSON'), 'json');
    assert.equal(detectFormat('export.xlsx'), null);
    assert.equal(detectFormat('csv'), null);
    assert.equal(detectFormat(''), null);
  });

  it('refuses a file before anything is read or sent', () => {
    assert.match(validateFile(null) ?? '', /Choose/);
    assert.match(validateFile({ name: 'a.xlsx', size: 10 }) ?? '', /CSV and JSON/);
    assert.match(validateFile({ name: 'a.csv', size: 0 }) ?? '', /empty/);
    assert.match(validateFile({ name: 'a.csv', size: 16 * 1024 * 1024 }) ?? '', /15 MB/);
    assert.equal(validateFile({ name: 'a.csv', size: 1000 }), null);
    assert.equal(validateFile({ name: 'a.json', size: 15 * 1024 * 1024 }), null);
  });
});

describe('people import: submitting', () => {
  it('posts the file once to the existing endpoint and returns the job reference (202)', async () => {
    const calls: Array<{ method: string; path: string; body: unknown }> = [];
    const request: ImportRequest = async (method, path, body) => {
      calls.push({ method, path, body });
      return { status: 202, body: { success: true, data: { jobId: ID, status: 'QUEUED', dryRun: true, totalRows: 12, batchRef: 'people-export-v1-x' } } };
    };
    const out = await submitImport(request, { format: 'csv', content: 'a,b\n1,2', dryRun: true });
    assert.deepEqual(out, { jobId: ID, dryRun: true, totalRows: 12 });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { method: 'POST', path: PEOPLE_IMPORT_BASE, body: { format: 'csv', content: 'a,b\n1,2', dryRun: true } });
    assert.equal(PEOPLE_IMPORT_BASE, '/admin/people/import');
  });

  it('turns every upload failure into a safe sentence that never echoes the response', async () => {
    const leaky = (errorCode: string) => ({ success: false, errorCode, message: 'Asha Rao asha@acme.example SELECT * FROM people', details: { marker: 'ZZDETAILSZZ' } });
    const cases: Array<[number, string, RegExp]> = [
      [400, 'MISSING_COLUMNS', /required columns are missing/],
      [400, 'UNSUPPORTED_EXPORT_VERSION', /not supported/],
      [400, 'MALFORMED_CSV', /malformed/],
      [400, 'SOMETHING_NEW', /rejected as invalid/],
      [401, 'UNAUTHORIZED', /session has expired/],
      [403, 'FORBIDDEN', /permission/],
      [413, 'BATCH_TOO_LARGE', /more than 10,000 rows/],
      [413, 'PAYLOAD_TOO_LARGE', /too large/],
      [503, 'IMPORT_STORAGE_UNAVAILABLE', /Nothing was imported/],
      [503, 'IMPORT_QUEUE_UNAVAILABLE', /Nothing was imported/],
      [503, 'OTHER', /temporarily unavailable/],
      [500, 'INTERNAL_SERVER_ERROR', /request failed/],
    ];
    for (const [status, code, re] of cases) {
      await assert.rejects(
        () => submitImport(reply(status, leaky(code)), { format: 'json', content: '{}', dryRun: false }),
        (e: unknown) => {
          assert.ok(e instanceof ImportApiError);
          assert.equal(e.status, status);
          assert.match(e.message, re);
          for (const bad of ['Asha', 'acme', 'SELECT', 'ZZDETAILSZZ']) assert.ok(!e.message.includes(bad), `${status} ${code} leaked ${bad}`);
          return true;
        },
      );
    }
  });

  it('treats a network failure and an unexpected answer as safe errors', async () => {
    await assert.rejects(() => submitImport(async () => { throw new Error('connect ECONNREFUSED 10.0.0.1:4000'); }, { format: 'csv', content: 'x', dryRun: false }),
      (e: unknown) => e instanceof ImportApiError && e.status === 0 && !/ECONNREFUSED|10\.0/.test(e.message));
    await assert.rejects(() => submitImport(reply(202, { data: {} }), { format: 'csv', content: 'x', dryRun: false }), (e: unknown) => e instanceof ImportApiError);
  });

  it('describeFailure never uses response text', () => {
    assert.ok(!describeFailure(400, { errorCode: 'X', message: 'Asha' }).includes('Asha'));
    assert.match(describeFailure(0, null), /Could not reach/);
    assert.match(describeFailure(404, null), /no longer available/);
  });
});

describe('people import: polling until a terminal state', () => {
  const noWait = async () => undefined;

  it('polls until completed, delivers every update, and stops at the terminal one', async () => {
    const seq = [job({ status: 'QUEUED', processedRows: 0 }), job({ processedRows: 40 }), job({ processedRows: 80 }), job({ status: 'COMPLETED', processedRows: 100, completedAt: '2026-10-01T10:01:00.000Z' }), job({ status: 'RUNNING' })];
    let calls = 0;
    const seen: string[] = [];
    const out = await pollImportJob(async () => seq[calls++], ID, { onUpdate: (j) => seen.push(`${j.status}:${j.processedRows}`), sleep: noWait });
    assert.equal(out.reason, 'terminal');
    assert.equal(calls, 4); // never asks again after COMPLETED
    assert.deepEqual(seen, ['QUEUED:0', 'RUNNING:40', 'RUNNING:80', 'COMPLETED:100']);
  });

  it('every terminal status ends the polling, including a failed job that kept its progress', async () => {
    for (const status of ['COMPLETED', 'COMPLETED_WITH_ISSUES', 'DRY_RUN', 'FAILED'] as const) {
      let calls = 0;
      const out = await pollImportJob(async () => (++calls, job({ status, processedRows: 250, imported: 250, errorSummary: status === 'FAILED' ? 'The import could not be completed.' : null })), ID, { onUpdate: () => undefined, sleep: noWait });
      assert.equal(out.reason, 'terminal');
      assert.equal(calls, 1);
      assert.ok(isTerminal(status));
      if (status === 'FAILED' && out.reason === 'terminal') {
        assert.equal(out.job.processedRows, 250);
        assert.equal(out.job.errorSummary, 'The import could not be completed.');
      }
    }
  });

  it('retries transient failures a few times, then reports a safe error', async () => {
    let calls = 0;
    const flaky = await pollImportJob(async () => { if (++calls < 3) throw new ImportApiError(0, null, 'x'); return job({ status: 'COMPLETED' }); }, ID, { onUpdate: () => undefined, sleep: noWait });
    assert.equal(flaky.reason, 'terminal');
    calls = 0;
    const down = await pollImportJob(async () => { calls++; throw new ImportApiError(503, null, 'x'); }, ID, { onUpdate: () => undefined, sleep: noWait, maxConsecutiveErrors: 3 });
    assert.equal(down.reason, 'error');
    assert.equal(calls, 3);
  });

  it('stops at once when the session is lost or the job is gone', async () => {
    for (const status of [401, 403, 404]) {
      let calls = 0;
      const out = await pollImportJob(async () => { calls++; throw new ImportApiError(status, null, 'x'); }, ID, { onUpdate: () => undefined, sleep: noWait });
      assert.equal(out.reason, 'error');
      assert.equal(calls, 1);
    }
  });

  it('stops when told to (screen closed / another job opened) and never after that', async () => {
    let calls = 0;
    let stop = false;
    const out = await pollImportJob(async () => { calls++; if (calls === 2) stop = true; return job(); }, ID, { onUpdate: () => undefined, sleep: noWait, shouldStop: () => stop });
    assert.equal(out.reason, 'stopped');
    assert.equal(calls, 2);
  });

  it('gives up after a maximum number of polls', async () => {
    let calls = 0;
    const out = await pollImportJob(async () => (++calls, job()), ID, { onUpdate: () => undefined, sleep: noWait, maxPolls: 5 });
    assert.equal(out.reason, 'max');
    assert.equal(calls, 5);
  });

  it('backs off to a conservative interval', () => {
    assert.equal(pollDelay(0), 1000);
    assert.equal(pollDelay(100), POLL_DELAYS_MS[POLL_DELAYS_MS.length - 1]);
    assert.ok(POLL_DELAYS_MS.every((d) => d >= 1000 && d <= 5000));
  });

  it('fetchJob refuses an id that is not a job id without calling the API', async () => {
    let called = false;
    await assert.rejects(() => fetchJob(async () => { called = true; return { status: 200, body: {} }; }, '../../etc/passwd'), (e: unknown) => e instanceof ImportApiError && e.status === 404);
    assert.equal(called, false);
    const j = await fetchJob(reply(200, { data: apiJob({ status: 'COMPLETED' }) }), ID);
    assert.equal(j.status, 'COMPLETED');
  });
});

describe('people import: reload and history', () => {
  const store = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
  };

  it('remembers only a valid job reference for a reload, and forgets it', () => {
    const s = store();
    assert.equal(recallActiveJob(s), null);
    rememberActiveJob(s, 'not-a-uuid');
    assert.equal(recallActiveJob(s), null);
    rememberActiveJob(s, ID);
    assert.equal(recallActiveJob(s), ID);
    assert.deepEqual([...s.m.keys()], [ACTIVE_JOB_KEY]);
    assert.deepEqual([...s.m.values()], [ID]); // a reference, never file content
    s.setItem(ACTIVE_JOB_KEY, '<script>alert(1)</script>');
    assert.equal(recallActiveJob(s), null);
    forgetActiveJob(s);
    assert.equal(s.getItem(ACTIVE_JOB_KEY), null);
  });

  it('survives unavailable storage', () => {
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); } };
    assert.doesNotThrow(() => rememberActiveJob(broken, ID));
    assert.equal(recallActiveJob(broken), null);
    assert.doesNotThrow(() => forgetActiveJob(broken));
    assert.equal(recallActiveJob(null), null);
  });

  it('loads history as safe jobs with pagination, and handles an empty history', async () => {
    const paths: string[] = [];
    const request: ImportRequest = async (_m, path) => {
      paths.push(path);
      return { status: 200, body: { success: true, data: [apiJob({ status: 'COMPLETED', fullName: 'Asha Rao' }), { junk: true }, apiJob({ jobId: OTHER, status: 'FAILED', errorSummary: 'The import could not be completed.' })], pagination: { page: 2, limit: 10, totalItems: 12, totalPages: 2 } } };
    };
    const h = await fetchHistory(request, 2, 10);
    assert.equal(paths[0], `${PEOPLE_IMPORT_BASE}?page=2&limit=10`);
    assert.equal(h.items.length, 2); // the malformed entry is dropped
    assert.equal(h.page, 2);
    assert.equal(h.totalPages, 2);
    assert.equal(h.totalItems, 12);
    assert.ok(!JSON.stringify(h).includes('Asha'));
    const empty = await fetchHistory(reply(200, { data: [], pagination: { page: 1, limit: 10, totalItems: 0, totalPages: 1 } }), 1, 10);
    assert.deepEqual(empty.items, []);
    assert.equal(empty.totalItems, 0);
    await assert.rejects(() => fetchHistory(reply(403, { errorCode: 'FORBIDDEN' })), (e: unknown) => e instanceof ImportApiError && e.status === 403);
    const clamp: string[] = [];
    await fetchHistory(async (_m, p) => (clamp.push(p), { status: 200, body: { data: [] } }), -4, 9999);
    assert.equal(clamp[0], `${PEOPLE_IMPORT_BASE}?page=1&limit=100`);
  });
});

describe('people import: the screen is wired in and shows nothing it should not', () => {
  const root = resolve(import.meta.dirname, '../..');
  const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

  it('is registered as an admin tab, in the sidebar and the header', () => {
    assert.match(read('types/admin.ts'), /'people_import'/);
    assert.match(read('components/admin/admin-sidebar.tsx'), /id: 'people_import'/);
    assert.match(read('components/admin/admin-header.tsx'), /people_import:/);
    const page = read('app/admin/monarch/page.tsx');
    assert.match(page, /PeopleImportView/);
    assert.match(page, /activeTab === 'people_import'/);
  });

  it('the view uses the shared logic, only the existing endpoints, and never references forbidden fields', () => {
    const src = read('components/admin/views/people-import-view.tsx');
    assert.match(src, /from '@\/lib\/people-import'/);
    assert.ok(!/\/admin\/import\/(submit|preview)/.test(src), 'it must not use the company upload');
    for (const forbidden of ['batchRef', 'storageKey', 'contentSha256', 'requestedBy', 'fullName', 'email', 'linkedin', '{job.jobId', 'dangerouslySetInnerHTML']) {
      assert.ok(!src.includes(forbidden), `view references ${forbidden}`);
    }
  });

  it('the gateway forwards the import endpoints to the API, which authenticates them (no native handler, no weaker path)', () => {
    for (const path of ['admin/people/import', `admin/people/import/${ID}`]) {
      for (const method of ['GET', 'POST']) {
        assert.equal(routePolicy(path, method), 'UPSTREAM', `${method} ${path}`);
        assert.equal(routePolicy(path, method, 'fallback'), 'UPSTREAM', `${method} ${path} (fallback)`);
      }
    }
  });
});
