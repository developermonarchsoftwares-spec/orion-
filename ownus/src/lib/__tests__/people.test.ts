import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PEOPLE_FILTERS,
  assertionCopy,
  buildPeopleQuery,
  confidenceCopy,
  hasActiveFilters,
  lastVerifiedCopy,
  personInitials,
  verificationCopy,
} from '../people.ts';

describe('People layer: UI helpers', () => {
  it('buildPeopleQuery sends only non-default filters', () => {
    assert.deepEqual(buildPeopleQuery(DEFAULT_PEOPLE_FILTERS), { limit: '12', page: '1' });
    assert.deepEqual(
      buildPeopleQuery({
        ...DEFAULT_PEOPLE_FILTERS,
        q: '  anita ',
        department: 'SALES',
        decisionMakerType: 'FOUNDER_CEO',
        status: 'former',
        hasContact: true,
        decisionMakersOnly: true,
        page: 2,
      }),
      {
        limit: '12',
        page: '2',
        q: 'anita',
        department: 'SALES',
        decisionMakerType: 'FOUNDER_CEO',
        status: 'former',
        hasContact: 'true',
        decisionMakersOnly: 'true',
      },
    );
  });

  it('hasActiveFilters ignores the page number', () => {
    assert.equal(hasActiveFilters({ ...DEFAULT_PEOPLE_FILTERS, page: 4 }), false);
    assert.equal(hasActiveFilters({ ...DEFAULT_PEOPLE_FILTERS, verification: 'VERIFIED' }), true);
  });

  it('never words an unverified claim as known', () => {
    assert.equal(assertionCopy('KNOWN').label, 'Known');
    assert.equal(assertionCopy('LIKELY').label, 'Likely');
    assert.equal(assertionCopy('UNVERIFIED').label, 'Unverified');
    for (const s of ['UNVERIFIED', 'STALE', 'CONFLICTED', null] as const) {
      assert.notEqual(verificationCopy(s), 'Verified');
    }
    assert.equal(verificationCopy('VERIFIED'), 'Verified');
  });

  it('labels confidence', () => {
    assert.equal(confidenceCopy('HIGH'), 'High');
    assert.equal(confidenceCopy('LOW'), 'Low');
  });

  it('describes last verification without inventing dates', () => {
    const now = new Date('2026-09-29T00:00:00Z');
    assert.equal(lastVerifiedCopy(null, now), 'Never verified');
    assert.equal(lastVerifiedCopy('garbage', now), 'Never verified');
    assert.equal(lastVerifiedCopy('2026-09-29T00:00:00Z', now), 'Today');
    assert.equal(lastVerifiedCopy('2026-09-28T00:00:00Z', now), 'Yesterday');
    assert.equal(lastVerifiedCopy('2026-09-09T00:00:00Z', now), '20 days ago');
    assert.equal(lastVerifiedCopy('2026-03-29T00:00:00Z', now), '6 months ago');
  });

  it('builds initials', () => {
    assert.equal(personInitials('Anita Rao'), 'AR');
    assert.equal(personInitials('Madonna'), 'M');
    assert.equal(personInitials('  '), '?');
  });
});
