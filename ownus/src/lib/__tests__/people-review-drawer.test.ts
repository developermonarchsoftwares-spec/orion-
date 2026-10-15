import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  FORBIDDEN_MESSAGE,
  classifyLoadFailure,
  drawerPhase,
  drawerTitle,
  isActivateKey,
  isCloseKey,
  nextFocusTarget,
} from '../people-review-drawer.ts';

describe('People Review drawers: loading, unavailable and ready are distinct states', () => {
  it('loading -> success: title and phase follow the data', () => {
    assert.equal(drawerPhase(false, null), 'loading');
    assert.equal(drawerTitle('loading', 'role', null, ''), 'Loading...');
    assert.equal(drawerPhase(true, null), 'ready');
    assert.equal(drawerTitle('ready', 'role', null, 'Anil Deshmukh · CFO'), 'Anil Deshmukh · CFO');
  });

  it('loading -> 404: a distinct "not found" state with no retry and never the loading title', () => {
    const f = classifyLoadFailure(404, 'Role not found', 'role');
    assert.deepEqual([f.title, f.retryable], ['Role not found', false]);
    assert.match(f.message, /does not exist or is no longer available/);
    assert.equal(drawerPhase(false, f), 'unavailable');
    assert.equal(drawerTitle('unavailable', 'role', f, ''), 'Role not found');
    assert.notEqual(drawerTitle('unavailable', 'role', f, ''), 'Loading...');
  });

  it('loading -> 403: "unavailable" with the permission message, no retry', () => {
    const f = classifyLoadFailure(403, 'Forbidden resource', 'role');
    assert.deepEqual([f.title, f.message, f.retryable], ['Role unavailable', FORBIDDEN_MESSAGE, false]);
    assert.equal(drawerPhase(false, f), 'unavailable');
  });

  it('the quarantine drawer uses the same states with its own wording', () => {
    assert.equal(classifyLoadFailure(404, undefined, 'quarantine item').title, 'Quarantine item not found');
    assert.equal(classifyLoadFailure(403, undefined, 'quarantine item').title, 'Quarantine item unavailable');
  });

  it('401 asks to sign in again; any other failure (network, 500) is retryable and keeps the API message', () => {
    const expired = classifyLoadFailure(401, 'Unauthorized', 'role');
    assert.deepEqual([expired.retryable, /Sign in again/.test(expired.message)], [false, true]);
    const down = classifyLoadFailure(undefined, 'Failed to fetch', 'role');
    assert.deepEqual([down.retryable, down.message], [true, 'Failed to fetch']);
    assert.equal(classifyLoadFailure(500, '  ', 'role').message, 'It could not be loaded. Check your connection and try again.');
  });

  it('data wins over a stale failure (a retry that succeeded); a failure wins over loading', () => {
    const f = classifyLoadFailure(500, 'x', 'role');
    assert.equal(drawerPhase(true, f), 'ready');
    assert.equal(drawerPhase(false, f), 'unavailable');
  });
});

describe('People Review drawers: keyboard', () => {
  it('Escape closes unless something else already handled it', () => {
    assert.equal(isCloseKey('Escape', false), true);
    assert.equal(isCloseKey('Escape', true), false);
    for (const k of ['Enter', ' ', 'Tab', 'Esc', 'escape', 'ArrowDown']) assert.equal(isCloseKey(k, false), false);
  });

  it('Tab wraps inside the drawer: last -> first, Shift+first -> last, otherwise the browser moves focus', () => {
    assert.equal(nextFocusTarget(5, 4, false), 0);
    assert.equal(nextFocusTarget(5, 0, true), 4);
    assert.equal(nextFocusTarget(5, 2, false), null);
    assert.equal(nextFocusTarget(5, 2, true), null);
    assert.equal(nextFocusTarget(1, 0, false), 0);
    assert.equal(nextFocusTarget(1, 0, true), 0);
  });

  it('focus outside the drawer or on the drawer itself enters at the first (Tab) or last (Shift+Tab) control; an empty drawer is left alone', () => {
    assert.equal(nextFocusTarget(3, -1, false), 0);
    assert.equal(nextFocusTarget(3, -1, true), 2);
    assert.equal(nextFocusTarget(0, -1, false), null);
  });

  it('Enter and Space open a focused queue row; other keys do not', () => {
    assert.equal(isActivateKey('Enter'), true);
    assert.equal(isActivateKey(' '), true);
    for (const k of ['Escape', 'Tab', 'a', 'ArrowDown']) assert.equal(isActivateKey(k), false);
  });
});

describe('People Review drawers: wiring (source checks)', () => {
  const SRC = path.resolve(import.meta.dirname, '../..');
  const view = readFileSync(path.join(SRC, 'components/admin/views/people-review-view.tsx'), 'utf8');

  it('both drawers use the one drawer hook, the shared states and a focusable dialog', () => {
    assert.equal((view.match(/useDrawerA11y\(ref, onClose\)/g) ?? []).length, 2);
    assert.equal((view.match(/role="dialog" aria-modal="true"/g) ?? []).length, 2);
    assert.equal((view.match(/ref=\{ref\} tabIndex=\{-1\}/g) ?? []).length, 2);
    assert.equal((view.match(/aria-busy=\{phase === 'loading'\}/g) ?? []).length, 2);
    assert.equal((view.match(/drawerTitle\(phase,/g) ?? []).length, 2);
    assert.equal((view.match(/<Loader2 role="status" aria-label="Loading"/g) ?? []).length, 2);
    assert.equal((view.match(/aria-label="Close"/g) ?? []).length, 2);
  });

  it('Escape and focus handling live in the hook only, and restore focus to the opener', () => {
    assert.equal((view.match(/isCloseKey\(/g) ?? []).length, 1);
    assert.match(view, /opener\.focus\(\)/);
    assert.match(view, /document\.addEventListener\('keydown', onKey\)[\s\S]*document\.removeEventListener\('keydown', onKey\)/);
  });

  it('an unavailable drawer never keeps the endless spinner', () => {
    assert.equal((view.match(/!d \? \(failure \? null : <Loader2/g) ?? []).length, 2);
  });

  it('every queue row is keyboard-reachable through the same helper', () => {
    assert.equal((view.match(/<tr key=\{r\.id\}/g) ?? []).length, 3);
    assert.equal((view.match(/<tr key=\{r\.id\} \{\.\.\.rowProps\(/g) ?? []).length, 3);
  });

  it('the API error carries its HTTP status so the drawers can tell "gone" from "not allowed"', () => {
    assert.match(view, /Object\.assign\(new Error\(res\.status === 403 \? FORBIDDEN_MESSAGE : msg\), \{ status: res\.status \}\)/);
  });
});
