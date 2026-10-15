import * as fs from 'fs';
import * as path from 'path';
import { classifyRole, classifyWithTaxonomy, normalizeTitle } from '../classification/role-classifier';
import { RoleClassificationService } from '../classification/role-classification.service';
import { CURRENT_TAXONOMY_VERSION, KNOWN_TAXONOMY_VERSIONS, TAXONOMIES, getTaxonomy, taxonomyFingerprint } from '../classification/taxonomies';
import { TAXONOMY_V1 } from '../classification/taxonomies/v1';
import type { ITaxonomy } from '../classification/taxonomy.types';

/** Pinned: v1 is immutable once used. If this fails, you edited v1: add v2 instead and leave v1 untouched. */
const V1_FINGERPRINT = '602349ff8bc73503c7bb850e787dba48c53efafd8889d1735643f7cac48328c2';

/** A deliberately different "v2": the same engine with one reinterpreted rule. Test-only; never registered. */
const makeV2 = (): ITaxonomy => ({
  ...TAXONOMY_V1,
  version: 'v2',
  executiveRules: [
    // v2 decides that a plain "director" is not a decision maker without an executive qualifier
    ...TAXONOMY_V1.executiveRules.filter((r) => r.id !== 'DM-EXEC-DIRECTOR-PARTNER'),
  ],
});

describe('Role classification versioning (Phase 6.5)', () => {
  describe('taxonomy versions', () => {
    it('uses an explicit "vN" label that is neither a package version nor a code hash', () => {
      expect(CURRENT_TAXONOMY_VERSION).toBe('v1');
      for (const v of KNOWN_TAXONOMY_VERSIONS) expect(v).toMatch(/^v[0-9]+$/);
      expect(Object.keys(TAXONOMIES)).toEqual(['v1']);
      expect(getTaxonomy('v1')).toBe(TAXONOMY_V1);
      expect(() => getTaxonomy('v99')).toThrow(/Unknown role taxonomy version/);
    });

    it('v1 is immutable: its pinned content fingerprint has not changed', () => {
      expect(taxonomyFingerprint(TAXONOMY_V1)).toBe(V1_FINGERPRINT);
    });

    it('every rule id is unique and stable-looking (no accidental duplicates)', () => {
      const t = TAXONOMY_V1;
      const ids = [
        ...t.titleAliases.map((r) => r.id),
        ...t.executiveAbbreviations.map((r) => r.id),
        ...t.departmentKeywords.map((r) => r.id),
        t.ownerLike.id,
        t.executiveFallback.id,
        ...t.seniority.map((r) => r.id),
        t.juniorCap.id,
        ...t.executiveRules.map((r) => r.id),
        ...Object.values(t.functionalRules).map((r) => r!.id),
        ...t.relationshipRules.map((r) => r.id),
      ];
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) expect(id).toMatch(/^[A-Z]+(-[A-Z0-9]+)+$/);
    });

    it('production rules live only in the versioned taxonomy files (no duplicate rule data elsewhere)', () => {
      const dir = path.resolve(__dirname, '../classification');
      const classifier = fs.readFileSync(path.join(dir, 'role-classifier.ts'), 'utf8');
      const config = fs.readFileSync(path.join(dir, 'role-taxonomy.config.ts'), 'utf8');
      for (const text of [classifier, config]) {
        expect(text).not.toMatch(/chief executive officer/);
      }
    });
  });

  describe('rules (real repository taxonomy terms) with stable ids', () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['CEO', { normalizedTitle: 'ceo', seniorityLevel: 'EXECUTIVE', department: 'EXECUTIVE', decisionMakerType: 'FOUNDER_CEO', strength: 'EXACT_RULE', ruleId: 'SEN-EXEC-C-SUITE-ABBR|DEP-EXEC-OWNER|DM-EXEC-FOUNDER-CEO|REL-EXECUTIVE' }],
      ['Chief Executive Officer', { normalizedTitle: 'ceo', decisionMakerType: 'FOUNDER_CEO', strength: 'NORMALIZED_RULE', ruleTrace: { aliases: ['ALIAS-CEO'], seniority: 'SEN-EXEC-C-SUITE-ABBR', department: 'DEP-EXEC-OWNER', decisionMaker: 'DM-EXEC-FOUNDER-CEO', relationship: 'REL-EXECUTIVE' } }],
      ['Co-Founder & CEO', { normalizedTitle: 'cofounder and ceo', seniorityLevel: 'EXECUTIVE', decisionMakerType: 'FOUNDER_CEO', relationshipType: 'FOUNDER', ruleId: 'SEN-EXEC-COFOUNDER|DEP-EXEC-OWNER|DM-EXEC-FOUNDER-CEO|REL-FOUNDER' }],
      ['Founder', { seniorityLevel: 'EXECUTIVE', decisionMakerType: 'FOUNDER_CEO', relationshipType: 'FOUNDER', strength: 'EXACT_RULE' }],
      ['Owner', { seniorityLevel: 'EXECUTIVE', decisionMakerType: 'FOUNDER_CEO', relationshipType: 'OWNER', ruleId: 'SEN-EXEC-OWNER|DEP-EXEC-OWNER|DM-EXEC-FOUNDER-CEO|REL-OWNER' }],
      ['Managing Director', { seniorityLevel: 'EXECUTIVE', department: 'EXECUTIVE', decisionMakerType: 'MANAGING_DIRECTOR', relationshipType: 'DIRECTOR', ruleId: 'SEN-EXEC-MANAGING-DIRECTOR|DEP-EXEC-OWNER|DM-EXEC-MANAGING-DIRECTOR|REL-DIRECTOR' }],
      ['Director', { seniorityLevel: 'DIRECTOR', department: 'EXECUTIVE', decisionMakerType: 'DIRECTOR_PARTNER', strength: 'FALLBACK', ruleId: 'SEN-DIRECTOR|DEP-EXEC-FALLBACK|DM-EXEC-DIRECTOR-PARTNER|REL-DIRECTOR' }],
      ['Director of Marketing', { seniorityLevel: 'DIRECTOR', department: 'MARKETING', decisionMakerType: 'MARKETING_DECISION_MAKER', relationshipType: 'EMPLOYEE', ruleId: 'SEN-DIRECTOR|DEP-KW-MARKETING|DM-FUNC-MARKETING|REL-EMPLOYEE' }],
      ['Vice President Operations', { normalizedTitle: 'vp operations', seniorityLevel: 'HEAD', department: 'OPERATIONS', decisionMakerType: 'OPERATIONS_DECISION_MAKER', strength: 'NORMALIZED_RULE', ruleId: 'SEN-HEAD-VP|DEP-KW-OPERATIONS|DM-FUNC-OPERATIONS|REL-EMPLOYEE' }],
      ['Head of Sales', { seniorityLevel: 'HEAD', department: 'SALES', decisionMakerType: 'SALES_DECISION_MAKER', ruleId: 'SEN-HEAD-HEAD|DEP-KW-SALES|DM-FUNC-SALES|REL-EMPLOYEE' }],
      ['General Manager', { seniorityLevel: 'HEAD', department: 'EXECUTIVE', decisionMakerType: 'GENERAL_MANAGER', strength: 'FALLBACK' }],
      ['Sales Manager', { seniorityLevel: 'MANAGER', department: 'SALES', decisionMakerType: null, ruleId: 'SEN-MANAGER-MANAGER|DEP-KW-SALES|DM-NONE-BELOW-MINIMUM|REL-EMPLOYEE' }],
      ['Purchasing Manager', { normalizedTitle: 'purchase manager', department: 'PROCUREMENT', decisionMakerType: 'PROCUREMENT_DECISION_MAKER', strength: 'NORMALIZED_RULE' }],
      ['Assistant Director', { seniorityLevel: 'DIRECTOR' }],
      ['Sales Executive', { seniorityLevel: 'STAFF', decisionMakerType: null, ruleId: 'SEN-STAFF-EXECUTIVE|DEP-KW-SALES|DM-NONE-SENIORITY|REL-EMPLOYEE' }],
      ['Intern', { seniorityLevel: 'STAFF', decisionMakerType: null }],
      ['Wizard of Whimsy', { seniorityLevel: 'UNKNOWN', department: 'UNKNOWN', decisionMakerType: null, strength: 'UNCLASSIFIED', ruleId: 'SEN-UNMATCHED|DEP-UNKNOWN-DEFAULT|DM-NONE-SENIORITY|REL-EMPLOYEE' }],
      ['', { seniorityLevel: 'UNKNOWN', department: 'UNKNOWN', strength: 'UNCLASSIFIED', relationshipType: 'OTHER', ruleId: 'SEN-UNMATCHED|DEP-EMPTY|DM-NONE-SENIORITY|REL-OTHER' }],
    ];

    it.each(cases)('"%s" is classified by v1 with its rule ids', (title, expected) => {
      const c = classifyRole(title);
      expect(c).toMatchObject({ taxonomyVersion: 'v1', ...expected });
      expect(c.ruleId).toBe([c.ruleTrace.seniority, c.ruleTrace.department, c.ruleTrace.decisionMaker, c.ruleTrace.relationship].join('|'));
    });

    it('confidence is a deterministic category, never a percentage', () => {
      const s = new Set(cases.map(([t]) => classifyRole(t).strength));
      for (const v of s) expect(['EXACT_RULE', 'NORMALIZED_RULE', 'FALLBACK', 'UNCLASSIFIED']).toContain(v);
      for (const [t] of cases) expect(typeof classifyRole(t).strength).toBe('string');
    });

    it('title aliases are recorded as rule ids and resolve to one normalised role identity', () => {
      const a = classifyRole('Chief Executive Officer');
      const b = classifyRole('CEO');
      expect(a.normalizedTitle).toBe(b.normalizedTitle); // Phase 4.1 role identity unchanged
      expect(a.ruleTrace.aliases).toEqual(['ALIAS-CEO']);
      expect(b.ruleTrace.aliases).toEqual([]);
    });
  });

  describe('determinism and reproducibility', () => {
    const corpus = ['CEO', 'Founder & CEO', 'Managing Director', 'Director of Marketing', 'Head of Sales', 'Sales Manager', 'Owner', 'General Manager', 'Wizard of Whimsy', 'Vice President Operations'];

    it('same input + same version = same output, independent of call order, repetition and process state', () => {
      const first = corpus.map((t) => classifyRole(t));
      const reversed = [...corpus].reverse().map((t) => classifyRole(t)).reverse();
      const again = corpus.map((t) => classifyWithTaxonomy(t, getTaxonomy('v1')));
      expect(reversed).toEqual(first);
      expect(again).toEqual(first);
      // a fresh service instance, as after a restart
      const svc = new RoleClassificationService();
      expect(corpus.map((t) => svc.classify(t))).toEqual(first);
      // global regex state must not leak between calls (the aliases are /g patterns)
      const base = classifyRole('Chief Executive Officer');
      for (let i = 0; i < 50; i++) expect(classifyRole('Chief Executive Officer')).toEqual(base);
    });

    it('does not depend on the clock', () => {
      const spy = jest.spyOn(Date, 'now').mockReturnValue(0);
      const a = classifyRole('Head of Sales');
      spy.mockReturnValue(4_102_444_800_000);
      expect(classifyRole('Head of Sales')).toEqual(a);
      spy.mockRestore();
    });

    it('historical v1 results keep their meaning when a later version changes the interpretation', () => {
      const v1Result = classifyRole('Director');
      expect(v1Result).toMatchObject({ taxonomyVersion: 'v1', decisionMakerType: 'DIRECTOR_PARTNER' });
      const v2 = makeV2();
      const v2Result = classifyWithTaxonomy('Director', v2);
      expect(v2Result.taxonomyVersion).toBe('v2');
      expect(v2Result.decisionMakerType).toBeNull(); // v2 reinterprets it
      // replaying the stored v1 version still reproduces the stored v1 answer
      expect(new RoleClassificationService().replay('Director', 'v1')).toEqual(v1Result);
      expect(classifyRole('Director')).toEqual(v1Result); // v1 object was not touched by building v2
      expect(taxonomyFingerprint(TAXONOMY_V1)).toBe(V1_FINGERPRINT);
      expect(taxonomyFingerprint(v2)).not.toBe(V1_FINGERPRINT);
    });

    it('normalizeTitle without an explicit taxonomy equals the current version', () => {
      expect(normalizeTitle('Chief Executive Officer')).toBe('ceo');
    });
  });

  describe('service boundary', () => {
    it('classification code does no I/O and never touches publishing, verification, suppression, companies or the database', () => {
      const dir = path.resolve(__dirname, '../classification');
      for (const f of ['role-classifier.ts', 'role-classification.service.ts', 'taxonomies/v1.ts', 'taxonomies/index.ts']) {
        const text = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        expect(text).not.toMatch(/database|drizzle|publish|verif|suppress|fetch\(|axios|http/i);
      }
    });
  });
});
