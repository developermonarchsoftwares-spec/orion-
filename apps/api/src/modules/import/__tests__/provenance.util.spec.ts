import {
  DEFAULT_FRESHNESS_DAYS,
  IMPORT_MAX_LEVEL,
  VERIFICATION_LEVELS,
  capImportLevel,
  emailLevel,
  freshness,
  gstinCheckChar,
  identifierLevel,
  phoneLevel,
  planFactMerge,
  websiteLevel,
} from '../provenance/provenance.util';
import { SourceTrustService } from '../services/source-trust.service';

describe('verification ladder (Phase 15)', () => {
  it('an import can reach format or structure checks and nothing higher: source support and control are never produced here', () => {
    expect(IMPORT_MAX_LEVEL).toBe('STRUCTURE_VALID');
    expect(capImportLevel('CONTROL_VERIFIED')).toBe('STRUCTURE_VALID');
    expect(capImportLevel('SOURCE_SUPPORTED')).toBe('STRUCTURE_VALID');
    expect(capImportLevel('FORMAT_VALID')).toBe('FORMAT_VALID');
    expect(VERIFICATION_LEVELS.indexOf('FORMAT_VALID')).toBeLessThan(VERIFICATION_LEVELS.indexOf('CONTROL_VERIFIED'));
  });

  describe('e-mail: a valid shape is only a valid shape', () => {
    it.each(['info@acme-example.com', 'a.b+tag@sub.example.co.in'])('%s is FORMAT_VALID (not deliverable, not owned)', (e) => expect(emailLevel(e)).toBe('FORMAT_VALID'));
    it.each(['', null, undefined, 'plain', 'a@b', 'a b@c.com', '@x.com', 'a@@b.com', 'a..b@c.com', 'x@y..com', `${'a'.repeat(70)}@example.com`])('%s is UNVERIFIED', (e) => expect(emailLevel(e as string)).toBe('UNVERIFIED'));
  });

  describe('phone', () => {
    it.each(['+91 98765 43210', '9876543210', '09876543210', '+91 22 67789999', '1800 123 4567'])('%s is FORMAT_VALID', (p) => expect(phoneLevel(p)).toBe('FORMAT_VALID'));
    it.each(['', null, '12345', '0000000000', '+91 12', 'call me', '5555555555555'])('%s is UNVERIFIED', (p) => expect(phoneLevel(p as string)).toBe('UNVERIFIED'));
  });

  describe('identifiers: format is not register authenticity', () => {
    it('a real published GSTIN passes the structural rules, including the check character', () => {
      const g = '27AAACT2727Q1ZW';
      expect(gstinCheckChar(g.slice(0, 14))).toBe(g[14]);
      expect(identifierLevel('GSTIN', g)).toBe('STRUCTURE_VALID');
      const constructed = `29AAACI4798L1Z${gstinCheckChar('29AAACI4798L1Z')}`;
      expect(identifierLevel('GSTIN', constructed)).toBe('STRUCTURE_VALID');
    });
    it('the second sample GSTIN shipped in the repository fixtures and import template has the right shape but a wrong check character: format valid only', () => {
      expect(identifierLevel('GSTIN', '29AAACI4397H1Z5')).toBe('FORMAT_VALID');
    });
    it('the right shape with a wrong check character is only FORMAT_VALID; the wrong shape is UNVERIFIED', () => {
      expect(identifierLevel('GSTIN', '27AAACT2727Q1ZA')).toBe('FORMAT_VALID');
      expect(identifierLevel('GSTIN', '99ZZZZZ9999Z1Z1')).not.toBe('STRUCTURE_VALID');
      expect(identifierLevel('GSTIN', '27AAACT2727Q1')).toBe('UNVERIFIED');
      expect(identifierLevel('GSTIN', '')).toBe('UNVERIFIED');
    });
    it('a state code outside the GST range is not structurally valid', () => {
      const body = '00AAACT2727Q1Z';
      expect(identifierLevel('GSTIN', body + gstinCheckChar(body))).toBe('FORMAT_VALID');
    });
    it('PAN: shape plus a known entity letter is structural; CIN has a shape only (no check character exists)', () => {
      expect(identifierLevel('PAN', 'AAACT2727Q')).toBe('STRUCTURE_VALID');
      expect(identifierLevel('PAN', 'AAAXT2727Q')).toBe('FORMAT_VALID');
      expect(identifierLevel('PAN', 'ABC123')).toBe('UNVERIFIED');
      expect(identifierLevel('CIN', 'L22210MH1995PLC084781')).toBe('FORMAT_VALID');
      expect(identifierLevel('CIN', 'X22210MH1995PLC084781')).toBe('UNVERIFIED');
    });
    it('other identifier kinds are stored with no claim', () => {
      expect(identifierLevel('UDYAM', 'UDYAM-MH-00-0000001')).toBe('UNVERIFIED');
      expect(identifierLevel('OTHER', 'anything')).toBe('UNVERIFIED');
    });
  });

  it('a website is only checked for being a well-formed web address', () => {
    expect(websiteLevel('https://www.tcs.com')).toBe('FORMAT_VALID');
    for (const u of ['', 'ftp://x.example.com', 'javascript:alert(1)', 'not a url', 'http://localhost']) expect(websiteLevel(u)).toBe('UNVERIFIED');
  });
});

describe('freshness (Phase 15)', () => {
  const now = new Date('2026-10-12T00:00:00Z');
  it('is reported, never acted on by deletion', () => {
    expect(freshness(null, now)).toBe('UNKNOWN');
    expect(freshness('garbage', now)).toBe('UNKNOWN');
    expect(freshness(new Date('2026-09-12T00:00:00Z'), now)).toBe('CURRENT');
    expect(freshness(new Date(now.getTime() - (DEFAULT_FRESHNESS_DAYS + 1) * 86_400_000), now)).toBe('STALE');
    expect(freshness(new Date(now.getTime() - (DEFAULT_FRESHNESS_DAYS - 1) * 86_400_000), now)).toBe('CURRENT');
  });
});

describe('merge planning (Phase 15)', () => {
  it('adds missing facts, ignores equal ones, and reports a difference as a conflict without overwriting', () => {
    const existing = { name: 'Acme Traders', legalName: null, description: '', foundingYear: 1990 };
    const plan = planFactMerge(existing, { name: '  ACME   traders ', legalName: 'Acme Traders Pvt Ltd', description: 'We trade', foundingYear: 1995 });
    expect(plan.add).toEqual({ legalName: 'Acme Traders Pvt Ltd', description: 'We trade' });
    expect(plan.conflicts).toEqual(['foundingYear']);
  });
  it('blank incoming values change nothing', () => {
    expect(planFactMerge({ name: 'A' }, { name: '', legalName: null, description: '  ' })).toEqual({ add: {}, conflicts: [] });
  });
});

describe('source trust decisions (Phase 15)', () => {
  const svc = new SourceTrustService({} as never);
  const src = (trustStatus: string, isActive = true) => ({ trustStatus, isActive }) as never;

  it('an approved, active source publishes; nothing else does without an explicit override', () => {
    expect(svc.assess(src('APPROVED'), false)).toMatchObject({ allowed: true, code: 'APPROVED', overrideUsed: false });
    for (const t of ['UNREVIEWED', 'RESTRICTED']) {
      expect(svc.assess(src(t), false)).toMatchObject({ allowed: false, code: 'SOURCE_NOT_APPROVED' });
      expect(svc.assess(src(t), true)).toMatchObject({ allowed: true, code: 'OVERRIDE', overrideUsed: true });
    }
  });
  it('no named source means unknown provenance: refused unless overridden, and the override is recorded as such', () => {
    expect(svc.assess(null, false)).toMatchObject({ allowed: false, trust: 'NONE' });
    expect(svc.assess(null, true)).toMatchObject({ allowed: true, trust: 'NONE', overrideUsed: true });
  });
  it('a revoked or switched-off source is refused even with an override', () => {
    expect(svc.assess(src('REVOKED'), true)).toMatchObject({ allowed: false, code: 'SOURCE_REVOKED' });
    expect(svc.assess(src('APPROVED', false), true)).toMatchObject({ allowed: false, code: 'SOURCE_INACTIVE' });
  });
});
