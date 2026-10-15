import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_REVIEW_STATE,
  DEFAULT_ROLES_FILTERS,
  buildReviewSearch,
  clampPage,
  clearReviewSearch,
  isReviewUrl,
  isRoleId,
  navigationMode,
  parseReviewUrl,
  reviewParams,
  type IReviewUiState,
} from '../people-review-url.ts';

const R1 = '3f1c2d4e-0000-4000-8000-000000000001';
const R2 = '3f1c2d4e-0000-4000-8000-000000000002';
const roles = (over: Partial<IReviewUiState['roles']> = {}, role: string | null = null): IReviewUiState => ({ ...DEFAULT_REVIEW_STATE, tab: 'roles', roles: { ...DEFAULT_ROLES_FILTERS, ...over }, role });

describe('People Review URL state: encoding and decoding', () => {
  it('the default state writes only the section marker', () => {
    assert.equal(buildReviewSearch(DEFAULT_REVIEW_STATE), '?section=people_review');
    assert.equal(buildReviewSearch(roles()), '?section=people_review&pr=roles');
  });

  it('filter, search, page and selected role round-trip', () => {
    const state = roles({ status: 'APPROVED', q: 'anil d', company: 'Meridian', verification: 'VERIFIED', decisionMakerType: 'FOUNDER_CEO', source: 'PARTNER_FEED', minConfidence: '60', hasEvidence: 'true', sort: 'confidence_desc', page: '3' }, R1);
    const search = buildReviewSearch(state);
    assert.match(search, /^\?section=people_review&pr=roles&/);
    assert.deepEqual(parseReviewUrl(search).state, state);
    assert.equal(parseReviewUrl(search).invalidRole, false);
  });

  it('every sub-tab round-trips with its own filters only', () => {
    const triage: IReviewUiState = { ...DEFAULT_REVIEW_STATE, tab: 'triage', triage: { category: 'CONFLICT', priority: 'HIGH', status: 'OPEN', q: 'meridian', detectedFrom: '2026-09-01', page: '2' }, role: R2 };
    assert.deepEqual(parseReviewUrl(buildReviewSearch(triage)).state, triage);
    const quarantine: IReviewUiState = { ...DEFAULT_REVIEW_STATE, tab: 'quarantine', quarantine: { status: 'ALL', code: 'MISSING_TITLE', page: '4' } };
    assert.deepEqual(parseReviewUrl(buildReviewSearch(quarantine)).state, quarantine);
  });

  it('only the active sub-tab filters are written and read (switching sub-tab starts clean)', () => {
    const mixed: IReviewUiState = { ...DEFAULT_REVIEW_STATE, tab: 'quarantine', roles: { ...DEFAULT_ROLES_FILTERS, q: 'ignored' }, quarantine: { status: 'RESOLVED', code: '', page: '1' } };
    assert.equal(buildReviewSearch(mixed), '?section=people_review&pr=quarantine&status=RESOLVED');
    // a stray filter of another sub-tab, or a status that does not exist for this sub-tab, is ignored
    assert.deepEqual(parseReviewUrl('?section=people_review&pr=quarantine&category=CONFLICT&status=APPROVED').state.quarantine, { status: 'PENDING', code: '', page: '1' });
  });

  it('a hand-edited URL can never produce an impossible state: bad values fall back to the defaults', () => {
    const s = parseReviewUrl('?section=people_review&pr=bogus&status=NOPE&page=-3&sort=drop table&minConfidence=900').state;
    assert.equal(s.tab, 'triage');
    const r = parseReviewUrl('?section=people_review&pr=roles&status=NOPE&page=-3&sort=drop%20table&minConfidence=900&hasEvidence=maybe&dm=KING').state.roles;
    assert.deepEqual(r, DEFAULT_ROLES_FILTERS);
    for (const bad of ['0', '1.5', 'abc', '1e3', '999999999999', '']) assert.equal(parseReviewUrl(`?pr=roles&page=${bad}`).state.roles.page, '1');
    assert.equal(parseReviewUrl(`?pr=roles&q=${'x'.repeat(500)}`).state.roles.q.length, 100);
    assert.equal(parseReviewUrl('?pr=triage&since=not-a-date').state.triage.detectedFrom, '');
  });

  it('the selected role must be a UUID; anything else is ignored, flagged and never passed on', () => {
    assert.equal(isRoleId(R1), true);
    assert.equal(isRoleId('../../admin/users'), false);
    assert.equal(isRoleId("1' OR '1'='1"), false);
    assert.equal(isRoleId(''), false);
    for (const bad of ['abc', '../x', `${R1}/extra`, '12345']) {
      const p = parseReviewUrl(`?section=people_review&pr=roles&role=${encodeURIComponent(bad)}`);
      assert.equal(p.state.role, null);
      assert.equal(p.invalidRole, true);
    }
    assert.equal(parseReviewUrl(`?role=${R1.toUpperCase()}`).state.role, R1); // normalised to lower case
    assert.equal(parseReviewUrl('?section=people_review').invalidRole, false);
  });

  it('foreign query parameters are preserved; clearing removes only this screen\'s parameters', () => {
    const search = buildReviewSearch(roles({ q: 'x' }, R1), '?utm=keep&role=old&page=9');
    const p = new URLSearchParams(search);
    assert.equal(p.get('utm'), 'keep');
    assert.equal(p.get('role'), R1);
    assert.equal(p.get('page'), null);
    assert.equal(clearReviewSearch(search), '?utm=keep');
    assert.equal(clearReviewSearch('?section=people_review&pr=roles&role=' + R1), '');
  });

  it('isReviewUrl recognises only the exact section marker', () => {
    assert.equal(isReviewUrl('?section=people_review'), true);
    for (const s of ['', '?section=people', '?section=users', '?pr=roles', '?section=PEOPLE_REVIEW']) assert.equal(isReviewUrl(s), false);
  });

  it('reviewParams never contains an internal id other than the role id', () => {
    const keys = reviewParams(roles({ q: 'a', page: '2' }, R1)).map(([k]) => k);
    assert.deepEqual(keys, ['section', 'pr', 'q', 'page', 'role']);
  });
});

describe('People Review navigation (history model)', () => {
  /** The browser: a stack of entries and an index; navigate() is the view\'s rule. */
  const browser = (initial: string) => {
    const stack = [initial];
    let i = 0;
    return {
      get search() { return stack[i]; },
      get state() { return parseReviewUrl(stack[i]).state; },
      get length() { return stack.length; },
      go(next: IReviewUiState) {
        const prev = parseReviewUrl(stack[i]).state;
        const url = buildReviewSearch(next, stack[i]);
        if (url === stack[i]) return;
        if (navigationMode(prev, next) === 'push') { stack.splice(i + 1); stack.push(url); i++; } else stack[i] = url;
      },
      back() { if (i > 0) i--; },
      forward() { if (i < stack.length - 1) i++; },
    };
  };

  it('role A -> role B -> Back -> A -> Forward -> B', () => {
    const b = browser(buildReviewSearch(roles()));
    b.go({ ...b.state, role: R1 });
    b.go({ ...b.state, role: R2 });
    assert.equal(b.state.role, R2);
    b.back();
    assert.equal(b.state.role, R1);
    b.forward();
    assert.equal(b.state.role, R2);
  });

  it('closing the dossier is navigation and keeps the filters; Back reopens it', () => {
    const b = browser(buildReviewSearch(roles({ status: 'APPROVED', q: 'anil', page: '2' })));
    b.go({ ...b.state, role: R1 });
    b.go({ ...b.state, role: null });
    assert.deepEqual(b.state.roles, { ...DEFAULT_ROLES_FILTERS, status: 'APPROVED', q: 'anil', page: '2' });
    assert.equal(b.state.role, null);
    b.back();
    assert.equal(b.state.role, R1);
    assert.equal(b.state.roles.q, 'anil');
  });

  it('filter, search and page edits replace the entry: no history entry per keystroke', () => {
    const b = browser(buildReviewSearch(roles()));
    for (const q of ['a', 'an', 'ani', 'anil']) b.go({ ...b.state, roles: { ...b.state.roles, q } });
    b.go({ ...b.state, roles: { ...b.state.roles, status: 'APPROVED', page: '1' } });
    b.go({ ...b.state, roles: { ...b.state.roles, page: '2' } });
    assert.equal(b.length, 1);
    assert.deepEqual([b.state.roles.q, b.state.roles.status, b.state.roles.page], ['anil', 'APPROVED', '2']);
  });

  it('opening a role from another page of the queue does not touch the page or substitute another role; changing page or filter keeps the open role', () => {
    const b = browser(buildReviewSearch(roles({ page: '5' }, R1)));
    b.go({ ...b.state, roles: { ...b.state.roles, page: '6' } });
    b.go({ ...b.state, roles: { ...b.state.roles, q: 'zzz', page: '1' } });
    assert.equal(b.state.role, R1);
    assert.equal(b.length, 1);
    b.go({ ...b.state, role: R2 });
    assert.deepEqual([b.state.role, b.state.roles.q], [R2, 'zzz']);
  });

  it('switching sub-tab is navigation; Back returns to the previous sub-tab with its filters', () => {
    const b = browser(buildReviewSearch(roles({ q: 'anil' })));
    b.go({ ...DEFAULT_REVIEW_STATE, tab: 'quarantine' });
    assert.equal(b.state.tab, 'quarantine');
    b.back();
    assert.deepEqual([b.state.tab, b.state.roles.q], ['roles', 'anil']);
  });

  it('a page beyond the last page falls back to the last page that exists; a valid page is untouched', () => {
    assert.equal(clampPage('99', 3), '3');
    assert.equal(clampPage('2', 3), '2');
    assert.equal(clampPage('1', 1), '1');
    assert.equal(clampPage('5', 0), '5'); // no pages known yet: leave it
  });

  it('navigationMode: role or sub-tab change pushes, everything else replaces', () => {
    const base = roles();
    assert.equal(navigationMode(base, { ...base, role: R1 }), 'push');
    assert.equal(navigationMode({ ...base, role: R1 }, { ...base, role: R2 }), 'push');
    assert.equal(navigationMode({ ...base, role: R1 }, { ...base, role: null }), 'push');
    assert.equal(navigationMode(base, { ...base, tab: 'quarantine' }), 'push');
    assert.equal(navigationMode(base, { ...base, roles: { ...base.roles, q: 'x' } }), 'replace');
  });
});

describe('People Review state: persistence boundaries and safety (source checks)', () => {
  const SRC = path.resolve(import.meta.dirname, '../..');
  const read = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8');
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const view = read('components/admin/views/people-review-view.tsx');

  it('uses the URL, not browser storage, and every navigation goes through one function', () => {
    assert.doesNotMatch(view, /localStorage\.setItem|sessionStorage/);
    assert.equal((view.match(/localStorage\./g) ?? []).length, 1); // the pre-existing admin token read in call()
    assert.equal((view.match(/history\[/g) ?? []).length, 1);
    assert.equal((view.match(/history\.replaceState/g) ?? []).length, 2); // mount normalisation and leaving the section
    assert.doesNotMatch(view, /useSearchParams|router\.(push|replace)/);
  });

  it('the drawers are keyed by their id, so Back / Forward never shows the previous item\'s data', () => {
    assert.match(view, /<RoleDrawer key=\{ui\.role\} id=\{ui\.role\}/);
    assert.match(view, /<QuarantineDrawer key=\{ui\.quarantineItem\} id=\{ui\.quarantineItem\}/);
    assert.equal((view.match(/<RoleDrawer/g) ?? []).length, 1); // one place opens each: the URL state
    assert.equal((view.match(/<QuarantineDrawer/g) ?? []).length, 1);
    assert.doesNotMatch(view, /setOpenId|setOpen\(/); // no local drawer state left in the queues
  });

  it('only the admin page and the People Review view use the URL state module; the page honours only the People Review section', () => {
    const users = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes('__tests__')).filter((f) => /people-review-url/.test(readFileSync(f, 'utf8'))).map((f) => path.relative(SRC, f).replace(/\\/g, '/')).sort();
    assert.deepEqual(users, ['app/admin/monarch/page.tsx', 'components/admin/views/people-review-view.tsx']);
    const page = read('app/admin/monarch/page.tsx');
    assert.equal((page.match(/isReviewUrl\(/g) ?? []).length, 1);
    assert.match(page, /isReviewUrl\(window\.location\.search\) \? 'people_review' : 'dashboard'/);
  });

  it('no customer-facing code knows the review URL parameters or the internal review endpoints', () => {
    for (const f of walk(SRC).filter((x) => /\.(ts|tsx)$/.test(x) && !x.includes('__tests__') && !x.includes(`${path.sep}admin${path.sep}`) && !/people-review-url|people-provenance/.test(x))) {
      assert.doesNotMatch(readFileSync(f, 'utf8'), /section=people_review|people-review-url|internal\/people-review/, f);
    }
  });

  it('the dossier does not stay on an endless spinner when the role cannot be loaded', () => {
    assert.match(view, /!d \? \(failure \? null : <Loader2/);
  });
});

describe('People Review: quarantine item deep links (Phase 13)', () => {
  const Q1 = '7a1b2c3d-0000-4000-8000-0000000000a1';
  const Q2 = '7a1b2c3d-0000-4000-8000-0000000000a2';
  const base = { ...DEFAULT_REVIEW_STATE, tab: 'quarantine' as const };

  it('qitem round-trips next to the quarantine filters and page', () => {
    const state: IReviewUiState = { ...base, quarantine: { status: 'ALL', code: 'MISSING_TITLE', page: '2' }, quarantineItem: Q1 };
    const search = buildReviewSearch(state);
    assert.equal(search, `?section=people_review&pr=quarantine&status=ALL&code=MISSING_TITLE&page=2&qitem=${Q1}`);
    assert.deepEqual(parseReviewUrl(search).state, state);
  });

  it('a triage-opened quarantine drawer keeps the triage filters', () => {
    const state: IReviewUiState = { ...DEFAULT_REVIEW_STATE, tab: 'triage', triage: { ...DEFAULT_REVIEW_STATE.triage, category: 'QUARANTINE', q: 'meridian' }, quarantineItem: Q2 };
    assert.deepEqual(parseReviewUrl(buildReviewSearch(state)).state, state);
  });

  it('only one drawer: a role wins over a quarantine item, and neither is invented', () => {
    const both = parseReviewUrl(`?section=people_review&pr=roles&role=${Q1}&qitem=${Q2}`);
    assert.deepEqual([both.state.role, both.state.quarantineItem], [Q1, null]);
    const state: IReviewUiState = { ...base, role: Q1, quarantineItem: Q2 };
    assert.equal(new URLSearchParams(buildReviewSearch(state)).get('qitem'), null);
    assert.equal(parseReviewUrl('?section=people_review').state.quarantineItem, null);
  });

  it('an invalid qitem is ignored and flagged, never passed on', () => {
    for (const bad of ['abc', '../x', `${Q1}/x`, "1' OR '1'='1", '123']) {
      const p = parseReviewUrl(`?section=people_review&pr=quarantine&qitem=${encodeURIComponent(bad)}`);
      assert.equal(p.state.quarantineItem, null);
      assert.equal(p.invalidQuarantine, true);
      assert.equal(p.invalidRole, false);
    }
    assert.equal(parseReviewUrl(`?qitem=${Q1.toUpperCase()}`).state.quarantineItem, Q1);
  });

  it('qitem is owned by this screen: preserved foreign parameters stay, clearing removes it', () => {
    const search = buildReviewSearch({ ...base, quarantineItem: Q1 }, '?utm=keep&qitem=old');
    assert.equal(new URLSearchParams(search).get('qitem'), Q1);
    assert.equal(new URLSearchParams(search).get('utm'), 'keep');
    assert.equal(clearReviewSearch(search), '?utm=keep');
  });

  it('opening, switching and closing a quarantine drawer push; filter and page edits still replace', () => {
    assert.equal(navigationMode(base, { ...base, quarantineItem: Q1 }), 'push');
    assert.equal(navigationMode({ ...base, quarantineItem: Q1 }, { ...base, quarantineItem: Q2 }), 'push');
    assert.equal(navigationMode({ ...base, quarantineItem: Q1 }, { ...base, quarantineItem: null }), 'push');
    assert.equal(navigationMode({ ...base, quarantineItem: Q1 }, { ...base, role: Q2, quarantineItem: null }), 'push');
    assert.equal(navigationMode(base, { ...base, quarantine: { ...base.quarantine, page: '3' } }), 'replace');
  });

  it('item A -> close -> item B -> Back -> Back -> Forward walks the drawers in order, keeping the filters', () => {
    const stack = [buildReviewSearch({ ...base, quarantine: { status: 'ALL', code: '', page: '2' } })];
    let i = 0;
    const go = (next: IReviewUiState) => {
      const prev = parseReviewUrl(stack[i]).state;
      const url = buildReviewSearch(next, stack[i]);
      if (url === stack[i]) return;
      if (navigationMode(prev, next) === 'push') { stack.splice(i + 1); stack.push(url); i++; } else stack[i] = url;
    };
    const cur = () => parseReviewUrl(stack[i]).state;
    go({ ...cur(), quarantineItem: Q1 });
    go({ ...cur(), quarantineItem: null });
    go({ ...cur(), quarantineItem: Q2 });
    assert.equal(cur().quarantineItem, Q2);
    i--; assert.equal(cur().quarantineItem, null);
    i--; assert.equal(cur().quarantineItem, Q1);
    i++; assert.equal(cur().quarantineItem, null);
    assert.deepEqual(cur().quarantine, { status: 'ALL', code: '', page: '2' });
  });

  it('the quarantine drawer is reachable from both lists through the same URL state (no second mechanism)', () => {
    const view = readFileSync(path.join(path.resolve(import.meta.dirname, '../..'), 'components/admin/views/people-review-view.tsx'), 'utf8');
    assert.match(view, /onOpenQuarantine\(r\.refId\)/); // triage item -> the quarantine item id the existing API already returns
    assert.match(view, /rowProps\(\(\) => onOpen\(r\.id\)\)/); // quarantine row -> the same navigation
  });
});
