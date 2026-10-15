import { parseSearchIntent } from '../people-search.service';
import {
  normalizeContactValue,
  normalizeLinkedinUrl,
  normalizePersonName,
  splitPersonName,
} from '../people.utils';

describe('search intent parsing', () => {
  it('"Companies in Coimbatore with a Founder/CEO"', () => {
    const i = parseSearchIntent('Companies in Coimbatore with a Founder/CEO');
    expect(i.city).toBe('Coimbatore');
    expect(i.decisionMakerTypes).toEqual(['FOUNDER_CEO']);
    expect(i.remainingQuery).toBe('');
  });

  it('"Companies with a Head of Procurement"', () => {
    const i = parseSearchIntent('Companies with a Head of Procurement');
    expect(i.decisionMakerTypes).toEqual(['PROCUREMENT_DECISION_MAKER']);
    expect(i.city).toBeUndefined();
  });

  it('"Companies with Sales Directors" resolves to the specific type, not generic Director', () => {
    const i = parseSearchIntent('Companies with Sales Directors');
    expect(i.decisionMakerTypes).toEqual(['SALES_DECISION_MAKER']);
  });

  it('"Companies with verified decision makers"', () => {
    const i = parseSearchIntent('Companies with verified decision makers');
    expect(i.hasVerifiedDecisionMaker).toBe(true);
    expect(i.hasDecisionMaker).toBe(true);
  });

  it('"Companies where decision-maker contact is available"', () => {
    const i = parseSearchIntent('Companies where decision maker contact available');
    expect(i.hasDecisionMaker).toBe(true);
    expect(i.hasDecisionMakerContact).toBe(true);
  });

  it('leaves ordinary searches untouched', () => {
    expect(parseSearchIntent('Sharma Textiles')).toEqual({ remainingQuery: 'Sharma Textiles' });
    // Role words alone (e.g. a company name) are not intent.
    expect(parseSearchIntent('Partners Logistics')).toEqual({ remainingQuery: 'Partners Logistics' });
    expect(parseSearchIntent(undefined).remainingQuery).toBe('');
  });

  it('keeps residual keywords for the normal text search', () => {
    const i = parseSearchIntent('textile companies with a CTO');
    expect(i.decisionMakerTypes).toEqual(['TECHNOLOGY_DECISION_MAKER']);
    expect(i.remainingQuery).toBe('textile');
  });
});

describe('people normalisation', () => {
  it('normalises names and strips honorifics', () => {
    expect(normalizePersonName('Dr. Anil  Kumar')).toBe('anil kumar');
    expect(normalizePersonName('Smt. Lakshmi-Devi')).toBe('lakshmi devi');
    expect(splitPersonName('Anil Raj Kumar')).toEqual({ firstName: 'Anil', middleName: 'Raj', lastName: 'Kumar' });
    expect(splitPersonName('Madonna')).toEqual({ firstName: 'Madonna', middleName: null, lastName: null });
  });

  it('canonicalises LinkedIn profile URLs and rejects non-profiles', () => {
    expect(normalizeLinkedinUrl('https://in.linkedin.com/in/John-Doe/?trk=abc')).toBe('linkedin.com/in/john-doe');
    expect(normalizeLinkedinUrl('http://www.linkedin.com/in/john-doe')).toBe('linkedin.com/in/john-doe');
    expect(normalizeLinkedinUrl('https://linkedin.com/company/acme')).toBeNull();
    expect(normalizeLinkedinUrl('https://example.com/in/x')).toBeNull();
    expect(normalizeLinkedinUrl(null)).toBeNull();
  });

  it('canonicalises contact values', () => {
    expect(normalizeContactValue('WORK_EMAIL', '  John@Acme.COM ')).toBe('john@acme.com');
    expect(normalizeContactValue('PHONE', '098765 43210')).toBe('+919876543210');
    expect(normalizeContactValue('MOBILE', '+91 98765-43210')).toBe('+919876543210');
    expect(normalizeContactValue('MOBILE', '9876543210')).toBe('+919876543210');
  });
});
