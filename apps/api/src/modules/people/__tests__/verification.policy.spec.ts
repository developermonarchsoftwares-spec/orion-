import {
  assertionLevel,
  confidenceLevel,
  decisionMakerClaimLabel,
  effectiveVerification,
} from '../policies/verification.policy';

const NOW = new Date('2026-09-29T00:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

describe('verification policy', () => {
  describe('effectiveVerification', () => {
    it('honours VERIFIED only with verified evidence and a recent timestamp', () => {
      expect(
        effectiveVerification({ status: 'VERIFIED', lastVerifiedAt: daysAgo(10), verifiedEvidenceCount: 1, now: NOW }),
      ).toBe('VERIFIED');
    });

    it('downgrades VERIFIED without evidence to UNVERIFIED (never claims verification without evidence)', () => {
      expect(
        effectiveVerification({ status: 'VERIFIED', lastVerifiedAt: daysAgo(1), verifiedEvidenceCount: 0, now: NOW }),
      ).toBe('UNVERIFIED');
    });

    it('downgrades VERIFIED without a verification date', () => {
      expect(effectiveVerification({ status: 'VERIFIED', lastVerifiedAt: null, verifiedEvidenceCount: 3, now: NOW })).toBe(
        'UNVERIFIED',
      );
    });

    it('downgrades PARTIALLY_VERIFIED without evidence too', () => {
      expect(
        effectiveVerification({ status: 'PARTIALLY_VERIFIED', lastVerifiedAt: daysAgo(1), verifiedEvidenceCount: 0, now: NOW }),
      ).toBe('UNVERIFIED');
    });

    it('reports old verifications as STALE', () => {
      expect(
        effectiveVerification({ status: 'VERIFIED', lastVerifiedAt: daysAgo(400), verifiedEvidenceCount: 2, now: NOW }),
      ).toBe('STALE');
      expect(
        effectiveVerification({ status: 'PARTIALLY_VERIFIED', lastVerifiedAt: daysAgo(364), verifiedEvidenceCount: 2, now: NOW }),
      ).toBe('PARTIALLY_VERIFIED');
    });

    it('keeps CONFLICTED conflicted regardless of evidence', () => {
      expect(
        effectiveVerification({ status: 'CONFLICTED', lastVerifiedAt: daysAgo(1), verifiedEvidenceCount: 5, now: NOW }),
      ).toBe('CONFLICTED');
    });

    it('passes UNVERIFIED and STALE through', () => {
      expect(effectiveVerification({ status: 'UNVERIFIED', verifiedEvidenceCount: 9, now: NOW })).toBe('UNVERIFIED');
      expect(effectiveVerification({ status: 'STALE', verifiedEvidenceCount: 9, now: NOW })).toBe('STALE');
    });
  });

  describe('confidenceLevel', () => {
    it('bands the score', () => {
      expect(confidenceLevel(10, 'VERIFIED')).toBe('LOW');
      expect(confidenceLevel(40, 'VERIFIED')).toBe('MEDIUM');
      expect(confidenceLevel(74, 'VERIFIED')).toBe('MEDIUM');
      expect(confidenceLevel(75, 'VERIFIED')).toBe('HIGH');
    });

    it('never shows HIGH for unverified, stale or conflicted data', () => {
      expect(confidenceLevel(95, 'UNVERIFIED')).toBe('MEDIUM');
      expect(confidenceLevel(95, 'STALE')).toBe('MEDIUM');
      expect(confidenceLevel(95, 'CONFLICTED')).toBe('LOW');
    });

    it('tolerates bad input', () => {
      expect(confidenceLevel(NaN, 'VERIFIED')).toBe('LOW');
    });
  });

  describe('known / likely / unverified', () => {
    it('maps statuses to assertion levels', () => {
      expect(assertionLevel('VERIFIED')).toBe('KNOWN');
      expect(assertionLevel('PARTIALLY_VERIFIED')).toBe('LIKELY');
      expect(assertionLevel('UNVERIFIED')).toBe('UNVERIFIED');
      expect(assertionLevel('STALE')).toBe('UNVERIFIED');
      expect(assertionLevel('CONFLICTED')).toBe('UNVERIFIED');
    });

    it('words the decision-maker claim per assertion', () => {
      expect(decisionMakerClaimLabel('Sales Head', 'KNOWN')).toMatch(/^Decision maker/);
      expect(decisionMakerClaimLabel('Sales Head', 'LIKELY')).toMatch(/^Likely decision maker/);
      expect(decisionMakerClaimLabel('Sales Head', 'UNVERIFIED')).toMatch(/^Unverified role/);
    });
  });
});
