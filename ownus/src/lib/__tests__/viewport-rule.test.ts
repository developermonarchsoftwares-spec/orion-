import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { MIN_DESKTOP_WIDTH, isBlockedViewport } from '../viewport-rule.ts';

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const read = (rel: string) => fs.readFileSync(path.resolve(import.meta.dirname, rel), 'utf8');

describe('the desktop-only rule', () => {
  it('blocks narrow windows and lets narrow desktop windows through at the limit', () => {
    assert.equal(MIN_DESKTOP_WIDTH, 768);
    assert.equal(isBlockedViewport(767, DESKTOP_UA), true);
    assert.equal(isBlockedViewport(768, DESKTOP_UA), false);
    assert.equal(isBlockedViewport(872, DESKTOP_UA), false); // a half-width pane / zoomed browser
    assert.equal(isBlockedViewport(1023, DESKTOP_UA), false);
    assert.equal(isBlockedViewport(1366, DESKTOP_UA), false);
    assert.equal(isBlockedViewport(375, DESKTOP_UA), true);
  });

  it('phones stay blocked whatever their width, including a phone asking for a desktop-sized page', () => {
    for (const ua of [IPHONE_UA, ANDROID_UA]) {
      assert.equal(isBlockedViewport(390, ua), true);
      assert.equal(isBlockedViewport(1200, ua), true);
    }
  });

  it('an unknown width (0) never blocks a desktop browser', () => {
    assert.equal(isBlockedViewport(0, DESKTOP_UA), false);
  });

  it('the script, the first-paint classes and the stylesheet all use the same limit', () => {
    const guard = read('../../components/mobile-responsive-guard.tsx');
    const css = read('../../app/globals.css');
    assert.ok(guard.includes("from '@/lib/viewport-rule'"), 'the guard uses the shared rule');
    // Tailwind md: is 768px, the first paint before scripts run
    assert.ok(guard.includes("'max-md:flex md:hidden'") && guard.includes('max-md:hidden md:block'));
    assert.ok(!/max-lg:|lg:hidden|lg:block/.test(guard), 'no leftover 1024px classes');
    // the stylesheet blocks below MIN_DESKTOP_WIDTH, i.e. up to MIN_DESKTOP_WIDTH - 1
    assert.ok(css.includes(`@media (max-width: ${MIN_DESKTOP_WIDTH - 1}px)`));
    assert.ok(!css.includes('@media (max-width: 1023px)'));
  });

  it('the top bar keeps all five links (Credits included) reachable on narrow windows: icon only below 1024px, with names for tooltips and screen readers', () => {
    const bar = read('../../components/layout/topbar.tsx');
    assert.ok(bar.includes('aria-label={item.label}') && bar.includes('title={item.label}'));
    assert.ok(bar.includes('<span className="hidden lg:inline">{item.label}</span>'));
    assert.ok(/label: 'Credits', icon: Zap, href: '\/credits'/.test(bar));
  });
});
