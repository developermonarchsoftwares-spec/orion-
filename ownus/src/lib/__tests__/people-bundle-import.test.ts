import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ACTIVE_BUNDLE_KEY,
  BUNDLE_BASE,
  BUNDLE_MAX_ZIP_BYTES,
  ImportApiError,
  bundleProgressPercent,
  bundleReconciliationRows,
  bundleSummaryItems,
  bytesToBase64,
  describeFailure,
  fetchBundle,
  forgetActiveBundle,
  pollBundle,
  recallActiveBundle,
  rememberActiveBundle,
  submitBundle,
  toBundleResult,
  toBundleSummary,
  validateBundle,
  validateBundleFile,
} from '../people-import.ts';
import { routePolicy } from '../gateway-auth.ts';
import type { BundleResult, ImportRequest } from '../people-import.ts';

const ID = '0d3c4a8e-1111-4222-8333-444455556666';
const BUNDLE_ID = '20261002T100000Z-aabbccddeeff';
const FILE = 'orion_published_people_20261002T100000Z_aabbccdd_part-0001-of-0002.csv';
const FILE2 = 'orion_published_people_20261002T100000Z_aabbccdd_part-0002-of-0002.csv';
const RUN = 'people-export-v1-0123456789abcdef01234567';

const part = (n: number, over: Record<string, unknown> = {}) => ({
  partNumber: n, filename: n === 1 ? FILE : FILE2, status: 'COMPLETED', expectedRows: 6, jobId: ID, batchRef: RUN, totalRows: 6, processedRows: 6,
  imported: 5, updated: 1, unchanged: 0, valid: 0, quarantined: 0, rejected: 0, notProcessed: 0, errorSummary: null, ...over,
});
const apiBundle = (over: Record<string, unknown> = {}) => ({
  bundleImportId: ID, bundleId: BUNDLE_ID, format: 'csv', exportedAt: '2026-10-02T10:00:00.000Z', dryRun: false, status: 'COMPLETED',
  importedAt: '2026-10-02T11:00:00.000Z', completedAt: '2026-10-02T11:00:05.000Z', partCount: 2, completedParts: 2, failedParts: [], pendingParts: [], notImportedParts: [],
  parts: [part(1), part(2)],
  reconciliation: {
    manifest: { totalRows: 12, parts: 2 },
    orion: { totalRows: 12, parts: 2, completedParts: 2, imported: 10, updated: 2, unchanged: 0, valid: 0, quarantined: 0, rejected: 0, failed: 0, pending: 0 },
    balanced: true,
  },
  ...over,
});
const ok = (body: unknown, status = 200): ImportRequest => async () => ({ status, body });

describe('bundle file selection', () => {
  it('the screen limit sits below what the web gateway can carry (10 MiB request body, ZIP sent as base64 inside JSON)', () => {
    const GATEWAY_BODY = 10 * 1024 * 1024;
    const jsonBodyFor = (zipBytes: number) => Math.ceil(zipBytes / 3) * 4 + 64; // base64 plus the JSON wrapper
    assert.ok(jsonBodyFor(BUNDLE_MAX_ZIP_BYTES) < GATEWAY_BODY);
    assert.ok(jsonBodyFor(8 * 1024 * 1024) > GATEWAY_BODY); // an 8 MiB ZIP could not get through
  });

  it('accepts a non-empty .zip within the size limit only', () => {
    assert.equal(validateBundleFile({ name: 'orion_published_people_x_split.zip', size: 5000 }), null);
    assert.equal(validateBundleFile({ name: 'BUNDLE.ZIP', size: 5000 }), null);
    assert.match(validateBundleFile(null) ?? '', /Choose/);
    assert.match(validateBundleFile({ name: 'people.csv', size: 5 }) ?? '', /\.zip/);
    assert.match(validateBundleFile({ name: 'x.zip.exe', size: 5 }) ?? '', /\.zip/);
    assert.match(validateBundleFile({ name: 'x.zip', size: 0 }) ?? '', /empty/);
    assert.match(validateBundleFile({ name: 'x.zip', size: BUNDLE_MAX_ZIP_BYTES + 1 }) ?? '', /7 MB/);
    assert.equal(validateBundleFile({ name: 'x.zip', size: BUNDLE_MAX_ZIP_BYTES }), null);
  });

  it('base64 of raw bytes equals the standard encoding, including for a large file', () => {
    const small = Uint8Array.from([0, 1, 2, 250, 251, 255]);
    assert.equal(bytesToBase64(small), Buffer.from(small).toString('base64'));
    const big = new Uint8Array(3 * 1024 * 1024 + 7).map((_, i) => (i * 31) & 0xff);
    assert.equal(bytesToBase64(big), Buffer.from(big).toString('base64'));
    assert.equal(bytesToBase64(new Uint8Array(0)), '');
  });
});

describe('what the screen may show (allow-list)', () => {
  it('a validated bundle shows metadata only', () => {
    const s = toBundleSummary({
      valid: true, bundleId: BUNDLE_ID, format: 'json', exportedAt: '2026-10-02T10:00:00.000Z', partCount: 2, totalRows: 12, maxPartRows: 6,
      parts: [{ partNumber: 1, filename: FILE, rowCount: 6, bytes: 100, sha256: 'f'.repeat(64) }, { partNumber: 2, filename: '../evil.csv', rowCount: 6, bytes: 1 }],
      people: [{ full_name: 'Asha Rao' }], email: 'asha@x.example',
    });
    assert.ok(s);
    assert.deepEqual(Object.keys(s).sort(), ['bundleId', 'exportedAt', 'format', 'maxPartRows', 'partCount', 'parts', 'totalRows']);
    assert.deepEqual(s.parts, [{ partNumber: 1, filename: FILE, rowCount: 6, bytes: 100 }]); // an unexpected file name is dropped
    assert.doesNotMatch(JSON.stringify(s), /sha256|Asha|asha@|evil/);
    assert.equal(toBundleSummary({ ...{ valid: true, bundleId: 'x', format: 'csv', parts: [] } }), null);
    assert.equal(toBundleSummary({ valid: false, bundleId: BUNDLE_ID, format: 'csv', parts: [] }), null);
    assert.equal(toBundleSummary(null), null);
  });

  it('a bundle result keeps counts, statuses, file names and run references; nothing else can reach the screen', () => {
    const dirty = apiBundle({
      email: 'asha@example.com', rows: [{ full_name: 'Asha Rao' }], storageKey: 'people-imports/secret.csv', contentSha256: 'a'.repeat(64),
      parts: [part(1, { fullName: 'Asha Rao', phone: '+919811122233', filename: 'steal.csv', batchRef: 'sha-secret', jobId: 'not-a-uuid', errorSummary: 'x'.repeat(500) }), part(2)],
    });
    const r = toBundleResult(dirty);
    assert.ok(r);
    const text = JSON.stringify(r);
    for (const leak of ['asha@', 'Asha', '9811122233', 'people-imports', 'secret', 'steal.csv', 'aaaaaaaa']) assert.ok(!text.includes(leak), leak);
    assert.equal(r.parts[0].filename, '');
    assert.equal(r.parts[0].runRef, null);
    assert.equal(r.parts[0].jobId, null);
    assert.equal(r.parts[0].errorSummary?.length, 200);
    assert.equal(r.parts[1].filename, FILE2);
    assert.equal(r.parts[1].runRef, RUN);
    assert.deepEqual(Object.keys(r).sort(), ['bundleId', 'bundleImportId', 'completedAt', 'completedParts', 'dryRun', 'exportedAt', 'failedParts', 'format', 'importedAt', 'notImportedParts', 'partCount', 'parts', 'pendingParts', 'reconciliation', 'status']);
  });

  it('rejects objects that are not bundle imports and unknown statuses', () => {
    assert.equal(toBundleResult(null), null);
    assert.equal(toBundleResult({}), null);
    assert.equal(toBundleResult(apiBundle({ bundleImportId: 'nope' })), null);
    assert.equal(toBundleResult(apiBundle({ status: 'WEIRD' })), null);
    assert.equal(toBundleResult(apiBundle({ bundleId: 'x' })), null);
    assert.equal(toBundleResult(apiBundle({ format: 'xlsx' })), null);
    const r = toBundleResult(apiBundle({ parts: [part(1, { status: 'WEIRD' }), part(2, { status: 'NOT_QUEUED', jobId: null, batchRef: null })], failedParts: [1, 'x', -2, 3.5] }));
    assert.equal(r?.parts.length, 1);
    assert.deepEqual(r?.failedParts, [1]);
  });
});

describe('errors', () => {
  it('every bundle problem has a fixed sentence by machine code, never the response text', () => {
    for (const code of ['BUNDLE_ZIP_MALFORMED', 'BUNDLE_MANIFEST_MISSING', 'BUNDLE_PART_HASH_MISMATCH', 'BUNDLE_ZIP_UNSAFE_PATH', 'BUNDLE_ENQUEUE_INCOMPLETE', 'BUNDLE_EMPTY']) {
      const text = describeFailure(400, { errorCode: code, message: 'SELECT * FROM secrets postgres://u:p@h/db' });
      assert.ok(text.length > 10 && !/SELECT|postgres|secrets/.test(text), code);
    }
    assert.match(describeFailure(400, { errorCode: 'BUNDLE_PART_HASH_MISMATCH' }), /checksum/);
    assert.match(describeFailure(413, { errorCode: 'BUNDLE_TOO_LARGE' }), /too large/);
    assert.match(describeFailure(404, { errorCode: 'BUNDLE_IMPORT_NOT_FOUND' }), /no longer available/);
  });

  it('a problem in one part names the part number, from the structured details only', () => {
    assert.match(describeFailure(400, { errorCode: 'BUNDLE_PART_HASH_MISMATCH', details: { partNumber: 3 } }), /\(part 3\)$/);
    assert.doesNotMatch(describeFailure(400, { errorCode: 'BUNDLE_PART_HASH_MISMATCH', details: { partNumber: '3; DROP TABLE' } }), /\(part /);
    assert.doesNotMatch(describeFailure(400, { errorCode: 'BUNDLE_PART_HASH_MISMATCH', details: { partNumber: -1 } }), /\(part /);
    assert.doesNotMatch(describeFailure(400, { errorCode: 'MISSING_COLUMNS', details: { partNumber: 3 } }), /part 3/); // existing single-file messages are unchanged
  });

  it('existing single-file failure messages are unchanged', () => {
    assert.match(describeFailure(400, { errorCode: 'MISSING_COLUMNS' }), /required columns/);
    assert.match(describeFailure(503, null), /temporarily unavailable/);
  });
});

describe('requests', () => {
  it('validate and submit send the base64 once and return metadata only; the bundle is polled by its own id', async () => {
    const calls: Array<[string, string, unknown]> = [];
    const request: ImportRequest = async (m, p, b) => {
      calls.push([m, p, b]);
      if (p.endsWith('/validate')) return { status: 200, body: { data: { valid: true, bundleId: BUNDLE_ID, format: 'csv', exportedAt: '2026-10-02T10:00:00Z', partCount: 1, totalRows: 3, maxPartRows: 3, parts: [{ partNumber: 1, filename: FILE, rowCount: 3, bytes: 10 }] } } };
      if (m === 'POST') return { status: 202, body: { data: { bundleImportId: ID, partCount: 2, totalRows: 12 } } };
      return { status: 200, body: { data: apiBundle() } };
    };
    const s = await validateBundle(request, 'QUJD');
    assert.equal(s.bundleId, BUNDLE_ID);
    assert.deepEqual(await submitBundle(request, { content: 'QUJD', dryRun: true }), { bundleImportId: ID, partCount: 2, totalRows: 12 });
    assert.equal((await fetchBundle(request, ID)).status, 'COMPLETED');
    assert.deepEqual(calls.map(([m, p]) => [m, p]), [['POST', `${BUNDLE_BASE}/validate`], ['POST', BUNDLE_BASE], ['GET', `${BUNDLE_BASE}/${ID}`]]);
    assert.deepEqual(calls[0][2], { content: 'QUJD' });
    assert.deepEqual(calls[1][2], { content: 'QUJD', dryRun: true });
  });

  it('server failures become fixed sentences; a vanished or invalid id never reaches the network', async () => {
    await assert.rejects(validateBundle(ok({ errorCode: 'BUNDLE_PART_HASH_MISMATCH', message: 'raw text', details: { partNumber: 2 } }, 400), 'QUJD'), (e: unknown) => e instanceof ImportApiError && e.status === 400 && e.code === 'BUNDLE_PART_HASH_MISMATCH' && /part 2/.test(e.message) && !/raw text/.test(e.message));
    await assert.rejects(submitBundle(ok({}, 503), { content: 'x', dryRun: false }), (e: unknown) => e instanceof ImportApiError && e.status === 503);
    await assert.rejects(validateBundle(async () => { throw new Error('boom'); }, 'x'), (e: unknown) => e instanceof ImportApiError && e.status === 0);
    await assert.rejects(validateBundle(ok({ data: { surprise: true } }), 'x'), /unexpected answer/);
    await assert.rejects(submitBundle(ok({ data: { bundleImportId: 'bad' } }, 202), { content: 'x', dryRun: false }), /unexpected answer/);
    let hit = false;
    await assert.rejects(fetchBundle(async () => { hit = true; return { status: 200, body: {} }; }, 'not-a-uuid'), (e: unknown) => e instanceof ImportApiError && e.status === 404);
    assert.equal(hit, false);
  });
});

describe('polling and resuming', () => {
  const view = (status: string, completed: number): BundleResult => toBundleResult(apiBundle({ status, completedParts: completed }))!;
  it('follows until every part has finished, delivering each update', async () => {
    const seq = [view('QUEUED', 0), view('RUNNING', 1), view('COMPLETED', 2)];
    let i = 0;
    const seen: string[] = [];
    const out = await pollBundle(async () => seq[i++], ID, { onUpdate: (b) => seen.push(b.status), sleep: async () => undefined });
    assert.equal(out.reason, 'terminal');
    assert.deepEqual(seen, ['QUEUED', 'RUNNING', 'COMPLETED']);
  });
  it('a failed bundle is terminal, a lost session or vanished bundle stops at once, transient errors are retried', async () => {
    assert.equal((await pollBundle(async () => view('FAILED', 1), ID, { onUpdate: () => undefined, sleep: async () => undefined })).reason, 'terminal');
    for (const status of [401, 403, 404]) {
      let calls = 0;
      const out = await pollBundle(async () => { calls++; throw new ImportApiError(status, null, 'x'); }, ID, { onUpdate: () => undefined, sleep: async () => undefined });
      assert.deepEqual([out.reason, calls], ['error', 1]);
    }
    let n = 0;
    const out = await pollBundle(async () => { if (n++ < 2) throw new ImportApiError(503, null, 'x'); return view('COMPLETED', 2); }, ID, { onUpdate: () => undefined, sleep: async () => undefined });
    assert.equal(out.reason, 'terminal');
    let calls = 0;
    assert.equal((await pollBundle(async () => { calls++; throw new ImportApiError(0, null, 'x'); }, ID, { onUpdate: () => undefined, sleep: async () => undefined, maxConsecutiveErrors: 3 })).reason, 'error');
    assert.equal(calls, 3);
    assert.equal((await pollBundle(async () => view('RUNNING', 0), ID, { onUpdate: () => undefined, sleep: async () => undefined, maxPolls: 3 })).reason, 'max');
    assert.equal((await pollBundle(async () => view('RUNNING', 0), ID, { onUpdate: () => undefined, sleep: async () => undefined, shouldStop: () => true })).reason, 'stopped');
  });
  it('only the bundle reference is kept for a reload, and never file content', () => {
    const store = new Map<string, string>();
    const kv = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    rememberActiveBundle(kv, ID);
    assert.equal(store.get(ACTIVE_BUNDLE_KEY), ID);
    assert.equal(recallActiveBundle(kv), ID);
    rememberActiveBundle(kv, 'not-a-uuid');
    assert.equal(recallActiveBundle(kv), ID);
    store.set(ACTIVE_BUNDLE_KEY, 'tampered');
    assert.equal(recallActiveBundle(kv), null);
    forgetActiveBundle(kv);
    assert.equal(store.size, 0);
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); } };
    rememberActiveBundle(broken, ID); forgetActiveBundle(broken);
    assert.equal(recallActiveBundle(broken), null);
    assert.equal(recallActiveBundle(null), null);
  });
});

describe('presentation', () => {
  const r = (over: Record<string, unknown> = {}) => toBundleResult(apiBundle(over))!;
  it('the result card counts parts and outcomes; a dry run says "would be imported"', () => {
    assert.deepEqual(bundleSummaryItems(r()).map((i) => [i.label, i.value]), [['Parts completed', '2 / 2'], ['Imported', '10'], ['Updated', '2'], ['Unchanged', '0'], ['Quarantined', '0'], ['Rejected', '0']]);
    const dry = r({ dryRun: true, status: 'DRY_RUN', reconciliation: { ...apiBundle().reconciliation, orion: { ...apiBundle().reconciliation.orion, valid: 12, imported: 0, updated: 0 } } });
    assert.deepEqual(bundleSummaryItems(dry).map((i) => i.label), ['Parts completed', 'Would be imported', 'Quarantined', 'Rejected']);
    const failed = r({ status: 'FAILED', reconciliation: { ...apiBundle().reconciliation, orion: { ...apiBundle().reconciliation.orion, failed: 6 } } });
    assert.equal(bundleSummaryItems(failed).at(-1)?.value, '6');
  });
  it('the reconciliation table sets the manifest against Orion and names failed rows', () => {
    const rows = bundleReconciliationRows(r());
    assert.deepEqual(rows.map((x) => x.metric), ['Total rows', 'Parts', 'Imported', 'Updated', 'Unchanged', 'Quarantined', 'Rejected', 'Failed (not imported)']);
    assert.deepEqual(rows[0], { metric: 'Total rows', manifest: '12', orion: '12' });
    assert.deepEqual(rows[1], { metric: 'Parts', manifest: '2', orion: '2 completed of 2 queued' });
    assert.equal(rows.at(-1)?.orion, '0');
    const partial = r({ status: 'FAILED', completedParts: 1, reconciliation: { manifest: { totalRows: 12, parts: 2 }, orion: { totalRows: 12, parts: 2, completedParts: 1, imported: 6, updated: 0, unchanged: 0, valid: 0, quarantined: 0, rejected: 0, failed: 6, pending: 0 }, balanced: false } });
    const p = bundleReconciliationRows(partial);
    assert.equal(p[1].orion, '1 completed of 2 queued');
    assert.equal(p.at(-1)?.orion, '6');
    assert.equal(partial.reconciliation.balanced, false);
  });
  it('progress follows completed parts; a failed bundle never shows 100%', () => {
    assert.equal(bundleProgressPercent(r({ status: 'COMPLETED' })), 100);
    assert.equal(bundleProgressPercent(r({ status: 'RUNNING', completedParts: 1 })), 50);
    assert.equal(bundleProgressPercent(r({ status: 'FAILED', completedParts: 2 })), 100);
    assert.equal(bundleProgressPercent(r({ status: 'FAILED', completedParts: 1 })), 50);
    assert.equal(bundleProgressPercent(r({ partCount: 0, completedParts: 0 })), 0);
  });
});

describe('the gateway and the screen', () => {
  it('the bundle routes are not natively handled: they go to the API like the single-file import', () => {
    for (const [path, method] of [['admin/people/import/bundle', 'POST'], ['admin/people/import/bundle/validate', 'POST'], [`admin/people/import/bundle/${ID}`, 'GET']] as const) {
      assert.equal(routePolicy(path, method), 'UPSTREAM', path);
    }
  });
  it('the component renders only through the allow-listed view models', () => {
    const src = readFileSync(resolve(import.meta.dirname, '../../components/admin/views/people-bundle-import.tsx'), 'utf8');
    assert.match(src, /toBundle|bundleSummaryItems|bundleReconciliationRows/);
    assert.doesNotMatch(src, /dangerouslySetInnerHTML|localStorage|file\.text\(\)/); // the ZIP is only ever read as bytes and sent once
    assert.match(src, /sessionStorage/);
  });
});
