import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { NO_PROVENANCE_MESSAGE, buildProvenanceView, type IProvenanceObservation } from '../people-provenance.ts';

const obs = (over: Partial<IProvenanceObservation> = {}): IProvenanceObservation => ({
  source: { key: 'people-json', name: 'People Pipeline export', version: '1' },
  batchRef: 'people-export-v1-abc123',
  sourceRecordId: '3f1c2d4e-0000-4000-8000-000000000001',
  acquiredAt: '2026-09-29T10:00:00.000Z',
  observedAt: '2026-09-14T00:00:00.000Z',
  observedTitle: 'Chief Financial Officer',
  observedIsCurrent: true,
  ...over,
});

describe('People review dossier: import provenance view', () => {
  it('renders one imported role: source, batch, source record, acquired and observed time', () => {
    const v = buildProvenanceView({ available: true, truncated: false, observations: [obs()] });
    assert.equal(v.empty, false);
    assert.equal(v.heading, 'Import provenance');
    assert.deepEqual(v.rows[0], {
      key: v.rows[0].key,
      source: 'People Pipeline export (people-json)',
      batchRef: 'people-export-v1-abc123',
      sourceRecord: '3f1c2d4e-0000-4000-8000-000000000001',
      acquired: '2026-09-29 10:00 UTC',
      observed: '2026-09-14 00:00 UTC',
      reportedTitle: 'Chief Financial Officer',
      reportedCurrent: 'current',
    });
  });

  it('empty state: no observation, missing or unavailable provenance shows an explicit message and no rows', () => {
    for (const p of [undefined, null, { available: false, truncated: false, observations: [] }]) {
      const v = buildProvenanceView(p as never);
      assert.equal(v.empty, true);
      assert.equal(v.emptyMessage, NO_PROVENANCE_MESSAGE);
      assert.equal(v.rows.length, 0);
    }
    assert.match(NO_PROVENANCE_MESSAGE, /No import provenance available/);
  });

  it('incomplete provenance is shown as such, never filled in', () => {
    const v = buildProvenanceView({ available: true, truncated: false, observations: [obs({ observedAt: null, acquiredAt: null, observedTitle: null, observedIsCurrent: null, batchRef: '', source: { key: 'legacy', name: 'legacy', version: '1' } })] });
    assert.equal(v.rows[0].observed, 'not stated by the source');
    assert.equal(v.rows[0].acquired, 'not recorded');
    assert.equal(v.rows[0].batchRef, 'not recorded');
    assert.equal(v.rows[0].source, 'legacy');
    assert.equal(v.rows[0].reportedTitle, null);
    assert.equal(v.rows[0].reportedCurrent, null);
    assert.equal(buildProvenanceView({ available: true, truncated: false, observations: [obs({ observedAt: 'not-a-date' })] }).rows[0].observed, 'not stated by the source');
  });

  it('multiple observations (several runs / a re-import) are all listed in the order given, with a count', () => {
    const v = buildProvenanceView({ available: true, truncated: false, observations: [obs({ batchRef: 'people-export-v1-new' }), obs({ batchRef: 'people-export-v1-old', acquiredAt: '2026-08-01T00:00:00.000Z' })] });
    assert.equal(v.rows.length, 2);
    assert.deepEqual(v.rows.map((r) => r.batchRef), ['people-export-v1-new', 'people-export-v1-old']);
    assert.match(v.heading, /2 observations, newest first/);
    assert.equal(new Set(v.rows.map((r) => r.key)).size, 2);
    assert.equal(v.moreNote, null);
  });

  it('says when older observations are not listed', () => {
    const v = buildProvenanceView({ available: true, truncated: true, observations: [obs(), obs({ batchRef: 'b2' })] });
    assert.match(v.heading, /2\+ observations/);
    assert.equal(v.moreNote, 'Older observations are not listed.');
  });

  it('does not render any database id: the view has no observation id field', () => {
    const v = buildProvenanceView({ available: true, truncated: false, observations: [obs()] });
    assert.deepEqual(Object.keys(v.rows[0]).sort(), ['acquired', 'batchRef', 'key', 'observed', 'reportedCurrent', 'reportedTitle', 'source', 'sourceRecord']);
  });
});

describe('People provenance is internal: no customer-facing rendering', () => {
  const SRC = path.resolve(import.meta.dirname, '../..');
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const files = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes('__tests__'));

  it('only the internal People Review view (and its view-model) uses the provenance helper or the dossier field', () => {
    const users = files.filter((f) => /people-provenance|ProvenanceSection|\.provenance\b/.test(readFileSync(f, 'utf8'))).map((f) => path.relative(SRC, f).replace(/\\/g, '/')).sort();
    assert.deepEqual(users, ['components/admin/views/people-review-view.tsx']);
  });

  it('the customer People components never mention provenance, batch references or the review endpoints', () => {
    for (const f of ['components/people/company-people-section.tsx', 'lib/people.ts']) {
      const text = readFileSync(path.join(SRC, f), 'utf8');
      assert.doesNotMatch(text, /provenance|batchRef|sourceRecordId|people-review/i);
    }
  });
});
