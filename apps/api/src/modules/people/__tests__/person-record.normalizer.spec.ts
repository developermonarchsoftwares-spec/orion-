import { normalizeRawPerson, parseNameField } from '../ingestion/person-record.normalizer';
import { CsvPeopleSource, parseCsv } from '../ingestion/sources/people-sources';
import type { IRawPersonRecord } from '../ingestion/ingestion.types';
import {
  isGenericMailbox,
  isValidEmail,
  namesCompatible,
  normalizeLinkedinUrl,
  normalizePersonName,
  parsePhone,
} from '../people.utils';

const NOW = new Date('2026-09-29T00:00:00Z');
const base = (over: Partial<IRawPersonRecord> = {}): IRawPersonRecord => ({
  businessSlug: 'acme',
  personName: 'Arun Kumar',
  jobTitle: 'CEO',
  source: { type: 'MANUAL_IMPORT', reference: 'sheet-1' },
  ...over,
});
const ok = (raw: IRawPersonRecord) => {
  const r = normalizeRawPerson(raw, NOW);
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.reasons)}`);
  return r.record;
};
const codes = (raw: IRawPersonRecord) => {
  const r = normalizeRawPerson(raw, NOW);
  return r.ok ? [] : r.reasons.map((x) => x.code);
};
const warnCodes = (raw: IRawPersonRecord) => ok(raw).warnings.map((w) => w.code);

describe('person normalisation', () => {
  describe('names', () => {
    it.each([
      ['Mr. Arun Kumar - CEO', 'Arun Kumar', 'CEO'],
      ['ARUN KUMAR', 'Arun Kumar', ''],
      ['Arun Kumar', 'Arun Kumar', ''],
      ['Dr. Priya Nair, CA', 'Priya Nair', ''],
      ['Lakshmi-Devi Rao', 'Lakshmi-Devi Rao', ''],
      ['Shri Ramesh  Gupta – Managing Director', 'Ramesh Gupta', 'Managing Director'],
    ])('%s -> %s', (raw, name, title) => {
      expect(parseNameField(raw)).toEqual({ name, embeddedTitle: title });
    });

    it('spelling/case/honorific variants normalise to one dedupe key', () => {
      const keys = ['Mr. Arun Kumar - CEO', 'ARUN KUMAR', 'Arun Kumar', 'arun  kumar'].map((n) =>
        normalizePersonName(parseNameField(n).name),
      );
      expect(new Set(keys)).toEqual(new Set(['arun kumar']));
    });

    it('takes the title from the name field only when jobTitle is absent', () => {
      const r = ok(base({ personName: 'Mr. Arun Kumar - CEO', jobTitle: undefined }));
      expect(r.upsert.role.jobTitle).toBe('CEO');
      expect(r.warnings.map((w) => w.code)).toContain('TITLE_FROM_NAME');
      expect(warnCodes(base({ personName: 'Arun Kumar - Founder', jobTitle: 'CEO' }))).toContain('NAME_TITLE_SUFFIX_IGNORED');
    });

    it('rejects missing, placeholder, single-word or junk names', () => {
      expect(codes(base({ personName: '' }))).toContain('MISSING_NAME');
      expect(codes(base({ personName: 'N/A' }))).toContain('MISSING_NAME');
      expect(codes(base({ personName: 'Arun' }))).toContain('NAME_INCOMPLETE');
      expect(codes(base({ personName: 'Arun K1' }))).toContain('INVALID_NAME');
      expect(codes(base({ personName: 'arun@acme.com' }))).toContain('INVALID_NAME');
      for (const n of ['Unknown Person', 'Test User', 'Contact Name', 'N/A N/A', 'Not Available']) expect(codes(base({ personName: n }))).toContain('INVALID_NAME');
      expect(codes(base({ personName: 'Mannu Owner' }))).not.toContain('INVALID_NAME');
    });
  });

  describe('company association', () => {
    it('requires an association', () => {
      expect(codes(base({ businessSlug: undefined }))).toContain('MISSING_BUSINESS');
    });
    it('accepts id, slug or identifier and validates them', () => {
      expect(ok(base({ businessSlug: undefined, businessId: '11111111-1111-1111-1111-111111111111' })).businessRef.id).toBeDefined();
      expect(codes(base({ businessSlug: undefined, businessId: 'nope' }))).toContain('INVALID_BUSINESS_ID');
      expect(ok(base({ businessSlug: undefined, businessIdentifier: { type: 'cin', value: 'u123 45' } })).businessRef.identifier).toEqual({
        type: 'CIN',
        value: 'U12345',
      });
      expect(codes(base({ businessSlug: undefined, businessIdentifier: { type: 'BOGUS', value: 'x' } }))).toContain('INVALID_BUSINESS_IDENTIFIER');
    });
  });

  describe('phone numbers', () => {
    it.each([
      ['9876543210', '+919876543210'],
      ['098765 43210', '+919876543210'],
      ['+91 98765-43210', '+919876543210'],
      ['91 9876543210', '+919876543210'],
      ['0091 98765 43210', '+919876543210'],
      ['0422 255 0100', '+914222550100'],
      ['+1 (415) 555-2671', '+14155552671'],
      ['+44 20 7946 0958', '+442079460958'],
      ['+91 98765 43210 ext 12', '+919876543210'],
    ])('accepts %s', (raw, e164) => {
      expect(parsePhone(raw)).toEqual({ ok: true, e164 });
    });

    it.each([
      '12345',
      '0000000000',
      '1234567890',
      '5555555555555555',
      'call me',
      '+91 12345 67890',
      '14155552671', // no +: ambiguous, not guessed
      '+91 98765',
    ])('rejects %s', (raw) => {
      expect(parsePhone(raw).ok).toBe(false);
    });

    it('drops a bad phone with a warning but keeps the person', () => {
      const r = ok(base({ phone: '12345', mobile: '98765 43210' }));
      expect(r.warnings.map((w) => w.code)).toContain('INVALID_PHONE');
      expect(r.upsert.contacts).toEqual([expect.objectContaining({ type: 'MOBILE', value: '+919876543210' })]);
    });

    it('does not store the same number twice as phone and mobile', () => {
      const r = ok(base({ phone: '98765 43210', mobile: '+91 9876543210' }));
      expect(r.upsert.contacts).toHaveLength(1);
    });
  });

  describe('emails', () => {
    it('trims, lowercases and validates', () => {
      expect(ok(base({ email: '  Arun.Kumar@Acme.CO.in ' })).upsert.contacts![0].value).toBe('arun.kumar@acme.co.in');
    });
    it.each(['no-at-sign', 'a@b', 'a b@c.com', 'a..b@c.com', '.a@c.com', 'a@-c.com', 'a@c.c', '@c.com'])('drops invalid email %s', (email) => {
      expect(isValidEmail(email)).toBe(false);
      const r = ok(base({ email }));
      expect(r.upsert.contacts).toHaveLength(0);
      expect(r.warnings.map((w) => w.code)).toContain('INVALID_EMAIL');
    });
    it('drops shared mailboxes instead of attaching them to a person', () => {
      expect(isGenericMailbox('Info@acme.com')).toBe(true);
      const r = ok(base({ email: 'sales@acme.com' }));
      expect(r.upsert.contacts).toHaveLength(0);
      expect(r.warnings.map((w) => w.code)).toContain('GENERIC_MAILBOX');
    });
  });

  describe('LinkedIn', () => {
    it('canonicalises a personal profile', () => {
      expect(ok(base({ linkedinUrl: 'https://in.linkedin.com/in/Arun-Kumar-1a2b/?trk=x' })).upsert.person.linkedinUrl).toBe(
        'https://www.linkedin.com/in/arun-kumar-1a2b',
      );
    });
    it('drops company pages and malformed URLs', () => {
      for (const u of ['https://linkedin.com/company/acme', 'not a url', 'https://example.com/in/x']) {
        const r = ok(base({ linkedinUrl: u }));
        expect(r.upsert.person.linkedinUrl).toBeUndefined();
        expect(r.warnings.map((w) => w.code)).toContain('INVALID_LINKEDIN');
      }
      expect(normalizeLinkedinUrl('https://linkedin.com/in/%E0%A4%A')).toBeNull();
    });
  });

  describe('location', () => {
    it('splits a location string and fixes shouting case, without inventing parts', () => {
      expect(ok(base({ location: 'COIMBATORE, tamil nadu' })).upsert.person).toMatchObject({ city: 'Coimbatore', state: 'Tamil Nadu' });
      expect(ok(base({ location: 'Pune' })).upsert.person).toMatchObject({ city: 'Pune', state: undefined });
      expect(ok(base({ location: 'Pune, Maharashtra, India' })).upsert.person.country).toBe('India');
      expect(ok(base({ location: 'X, Y', city: 'Chennai' })).upsert.person).toMatchObject({ city: 'Chennai', state: undefined });
    });
  });

  describe('role classification and hints', () => {
    it('uses the shared classifier; hints are validated but never adopted', () => {
      const r = ok(base({ jobTitle: 'Head of Sales', seniority: 'director', department: 'marketing' }));
      expect(r.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['HINT_CONFLICT_SENIORITY', 'HINT_CONFLICT_DEPARTMENT']));
      expect(r.upsert.role.jobTitle).toBe('Head of Sales');
    });
    it('rejects unknown hint values and impossible combinations', () => {
      expect(codes(base({ department: 'WIZARDRY' }))).toContain('INVALID_HINT');
      expect(codes(base({ decisionMakerType: 'KING' }))).toContain('INVALID_HINT');
      expect(codes(base({ seniority: 'STAFF', decisionMakerType: 'FOUNDER_CEO' }))).toContain('INVALID_ROLE_COMBINATION');
      expect(codes(base({ department: 'FINANCE', decisionMakerType: 'SALES_DECISION_MAKER' }))).toContain('INVALID_ROLE_COMBINATION');
    });
    it('flags titles it cannot classify instead of guessing', () => {
      expect(warnCodes(base({ jobTitle: 'Chief Vibes Wrangler-ish' }))).toBeDefined();
      expect(warnCodes(base({ jobTitle: 'xyzzy' }))).toContain('UNCLASSIFIED_TITLE');
    });
    it('requires a job title', () => {
      expect(codes(base({ jobTitle: '' }))).toContain('MISSING_TITLE');
      expect(codes(base({ jobTitle: 'n/a' }))).toContain('MISSING_TITLE');
    });
  });

  describe('dates and current flag', () => {
    it('rejects impossible date combinations', () => {
      expect(codes(base({ startDate: '2024-05-01', endDate: '2023-01-01' }))).toContain('INVALID_DATES');
      expect(codes(base({ startDate: 'garbage' }))).toContain('INVALID_DATES');
      expect(codes(base({ startDate: '2031-01-01' }))).toContain('INVALID_DATES');
      expect(codes(base({ isCurrent: true, endDate: '2020-01-01' }))).toContain('CONFLICTING_CURRENT_FLAG');
      expect(codes(base({ isCurrent: 'maybe' }))).toContain('INVALID_CURRENT_FLAG');
    });
    it('an explicit past end date means the role is former; nothing is inferred otherwise', () => {
      expect(ok(base({ endDate: '2020-01-01' })).upsert.role.isCurrent).toBe(false);
      expect(ok(base({})).upsert.role.isCurrent).toBeUndefined();
      expect(ok(base({ isCurrent: 'former' })).upsert.role.isCurrent).toBe(false);
    });
  });

  describe('source metadata', () => {
    it('requires provenance', () => {
      expect(codes(base({ source: undefined }))).toContain('MISSING_SOURCE');
      expect(codes(base({ source: { type: 'CARRIER_PIGEON' } }))).toContain('INVALID_SOURCE_TYPE');
      expect(codes(base({ source: { type: 'MANUAL_IMPORT', url: 'ftp://x' } }))).toContain('INVALID_SOURCE_URL');
      expect(codes(base({ source: { type: 'MANUAL_IMPORT', url: 'nonsense' } }))).toContain('INVALID_SOURCE_URL');
      expect(codes(base({ source: { type: 'MANUAL_IMPORT', observedAt: 'yesterday-ish' } }))).toContain('INVALID_OBSERVED_AT');
      expect(codes(base({ source: { type: 'MANUAL_IMPORT', observedAt: '2031-01-01' } }))).toContain('INVALID_OBSERVED_AT');
    });
    it('does not default observedAt (so a re-run is detectable as unchanged)', () => {
      expect(ok(base()).upsert.evidence![0].observedAt).toBeUndefined();
    });
  });

  describe('verification claims', () => {
    it('needs verifiedAt and verifiedBy for VERIFIED / PARTIALLY_VERIFIED', () => {
      expect(codes(base({ verification: { status: 'VERIFIED' } }))).toContain('INVALID_VERIFICATION');
      expect(codes(base({ verification: { status: 'VERIFIED', verifiedAt: '2026-01-01' } }))).toContain('INVALID_VERIFICATION');
      expect(codes(base({ verification: { status: 'VERIFIED', verifiedAt: '2031-01-01', verifiedBy: 'x' } }))).toContain('INVALID_VERIFICATION');
      expect(codes(base({ verification: { status: 'STALE' } }))).toContain('INVALID_VERIFICATION');
      expect(codes(base({ verification: { status: 'GREAT' } }))).toContain('INVALID_VERIFICATION');
    });
    it('turns a genuine verification into role evidence carrying the verifier', () => {
      const r = ok(base({ verification: { status: 'VERIFIED', verifiedAt: '2026-08-01', verifiedBy: 'reviewer@orion' } }));
      expect(r.upsert.verificationStatus).toBe('VERIFIED');
      const ev = r.upsert.evidence!.find((e) => e.evidenceType === 'MANUAL_VERIFICATION')!;
      expect(ev.verifiedAt).toEqual(new Date('2026-08-01'));
      expect(ev.sourceReference).toBe('verified-by:reviewer@orion');
      expect(ev.scope).toBe('ROLE');
    });
    it('never verifies on its own: no verification block means no verified evidence', () => {
      const r = ok(base({ email: 'arun@acme.co.in', linkedinUrl: 'https://linkedin.com/in/arun' }));
      expect(r.upsert.verificationStatus).toBeUndefined();
      expect(r.upsert.evidence!.every((e) => !e.verifiedAt)).toBe(true);
    });
    it('rejects out-of-range confidence', () => {
      expect(codes(base({ confidenceScore: 140 }))).toContain('INVALID_CONFIDENCE');
      expect(codes(base({ confidenceScore: Number.NaN }))).toContain('INVALID_CONFIDENCE');
      expect(ok(base({ confidenceScore: 55 })).upsert.confidenceScore).toBe(55);
    });
  });

  describe('evidence shape', () => {
    it('records a claim per kind: role, identity, and each contact', () => {
      const r = ok(base({ email: 'arun@acme.co.in', phone: '98765 43210', linkedinUrl: 'https://linkedin.com/in/arun-k' }));
      expect(r.upsert.evidence!.map((e) => `${e.scope}:${e.evidenceType}`)).toEqual([
        'ROLE:ROLE_CLAIM',
        'PERSON:IDENTITY_CLAIM',
        'CONTACT:CONTACT_CLAIM',
        'CONTACT:CONTACT_CLAIM',
      ]);
    });
    it('collects every problem, not just the first', () => {
      expect(codes({})).toEqual(expect.arrayContaining(['MISSING_BUSINESS', 'MISSING_NAME', 'MISSING_TITLE', 'MISSING_SOURCE']));
    });
  });

  it('names are only "compatible" for the same surname and initial/prefix', () => {
    expect(namesCompatible('arun kumar', 'a kumar')).toBe(true);
    expect(namesCompatible('arun kumar', 'arun kumar')).toBe(true);
    expect(namesCompatible('arun kumar', 'arun kumaran')).toBe(false);
    expect(namesCompatible('arun kumar', 'varun kumar')).toBe(false);
    expect(namesCompatible('arun', 'arun kumar')).toBe(false);
  });
});

describe('CSV source', () => {
  it('parses quotes, embedded commas/newlines, CRLF and BOM', () => {
    const rows = parseCsv('﻿a,b\r\n"x, y","line1\nline2"\r\n\r\n"q""uote",z\r\n');
    expect(rows).toEqual([
      ['a', 'b'],
      ['x, y', 'line1\nline2'],
      ['q"uote', 'z'],
    ]);
  });

  it('maps aliased headers into raw records and leaves empty cells undefined', () => {
    const csv = [
      'Company Slug,Full Name,Designation,Work Email,Mobile,LinkedIn,Source Type,Source URL,Verified At,Verified By,Confidence,CIN',
      'acme,Arun Kumar,CEO,arun@acme.co.in,98765 43210,,MANUAL_IMPORT,https://example.com/p,,,70,',
      'acme,Priya Nair,CFO,,,,MANUAL_IMPORT,,,,,U12345TN2010PTC000001',
    ].join('\n');
    const [a, b] = [...new CsvPeopleSource('file.csv', csv).records()];
    expect(a).toMatchObject({
      businessSlug: 'acme',
      personName: 'Arun Kumar',
      jobTitle: 'CEO',
      email: 'arun@acme.co.in',
      mobile: '98765 43210',
      confidenceScore: 70,
      source: { type: 'MANUAL_IMPORT', url: 'https://example.com/p' },
    });
    expect(a.linkedinUrl).toBeUndefined();
    expect(a.verification).toBeUndefined();
    expect(b.businessIdentifier).toEqual({ type: 'CIN', value: 'U12345TN2010PTC000001' });
  });
});
