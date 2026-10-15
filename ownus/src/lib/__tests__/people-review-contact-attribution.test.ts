import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { attributionBadge, type IContactAttributionInfo } from '../people-review-contact-attribution.ts';

const a = (status: IContactAttributionInfo['status'], eligibleForThisCompany: boolean): IContactAttributionInfo => ({ status, eligibleForThisCompany });

describe('People review dossier: contact attribution badge', () => {
  it('reported only by this company', () => {
    assert.deepEqual(attributionBadge(a('THIS_COMPANY', true)), { label: 'Reported by this company', hint: "Eligible for this company's customer cards once published.", tone: 'ok' });
  });

  it('shared with another company', () => {
    const b = attributionBadge(a('SHARED', true))!;
    assert.equal(b.label, 'Shared with this company');
    assert.equal(b.tone, 'ok');
    assert.match(b.hint, /at least one other/);
  });

  it('reported only by another company: a warning that it is never shown on this company', () => {
    const b = attributionBadge(a('OTHER_COMPANY', false))!;
    assert.equal(b.label, 'Reported by another company');
    assert.equal(b.tone, 'warn');
    assert.match(b.hint, /Never shown on this company's customer cards/);
  });

  it('unattributed: "shown" for a one-company person, a warning "not shown" for a multi-company person', () => {
    const one = attributionBadge(a('UNATTRIBUTED', true))!;
    const many = attributionBadge(a('UNATTRIBUTED', false))!;
    assert.deepEqual([one.label, one.tone], ['Unattributed (shown)', 'muted']);
    assert.deepEqual([many.label, many.tone], ['Unattributed (not shown)', 'warn']);
    assert.match(many.hint, /no company card shows it/);
  });

  it('an answer the UI does not know, or none at all (an older API), shows no badge: nothing is invented', () => {
    assert.equal(attributionBadge(undefined), null);
    assert.equal(attributionBadge(null), null);
    assert.equal(attributionBadge({ status: 'SOMETHING_NEW' as never, eligibleForThisCompany: true }), null);
  });

  it('every badge is plain text: no id, no value, no domain reasoning', () => {
    for (const s of ['THIS_COMPANY', 'SHARED', 'OTHER_COMPANY', 'UNATTRIBUTED'] as const) {
      for (const eligible of [true, false]) {
        const b = attributionBadge(a(s, eligible))!;
        assert.deepEqual(Object.keys(b).sort(), ['hint', 'label', 'tone']);
        assert.doesNotMatch(`${b.label} ${b.hint}`, /[0-9a-f]{8}-[0-9a-f]{4}|@|domain|email address/i);
      }
    }
  });
});

describe('People review dossier: attribution wiring and boundaries (source checks)', () => {
  const SRC = path.resolve(import.meta.dirname, '../..');
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const view = readFileSync(path.join(SRC, 'components/admin/views/people-review-view.tsx'), 'utf8');

  it('the badge is shown next to each contact in the dossier, once, from the API\'s answer', () => {
    assert.equal((view.match(/<ContactAttributionBadge attribution=\{c\.attribution\} \/>/g) ?? []).length, 1);
    assert.match(view, /attribution\?: IContactAttributionInfo/);
  });

  it('only the internal review view uses the attribution wording; no customer-facing code does', () => {
    const users = walk(SRC)
      .filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes('__tests__'))
      .filter((f) => /people-review-contact-attribution|attributionBadge|ContactAttributionBadge/.test(readFileSync(f, 'utf8')))
      .map((f) => path.relative(SRC, f).replace(/\\/g, '/'))
      .sort();
    assert.deepEqual(users, ['components/admin/views/people-review-view.tsx', 'lib/people-review-contact-attribution.ts']);
    for (const f of ['components/people/company-people-section.tsx', 'lib/people.ts']) {
      assert.doesNotMatch(readFileSync(path.join(SRC, f), 'utf8'), /attribution|THIS_COMPANY|OTHER_COMPANY|UNATTRIBUTED/i);
    }
  });

  it('the Quarantine action is not offered on a rejected role (the API refuses it); Reject stays available for quarantined roles', () => {
    assert.match(view, /d\.role\.reviewStatus !== 'REJECTED' && <button className=\{btn\}[\s\S]{0,200}Role quarantined/);
    assert.doesNotMatch(view, /reviewStatus !== 'QUARANTINED' && <button[\s\S]{0,160}Role rejected/);
  });
});
