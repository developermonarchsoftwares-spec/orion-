import { chromium } from '../../node_modules/playwright/index.mjs';
const b = await chromium.launch({ channel: 'chrome' });
const p = await b.newPage({ viewport: { width: 1800, height: 2400 } });
await p.goto('file:///D:/ownus/showreel2/poster/poster.html', { waitUntil: 'networkidle' });
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(500);
await p.screenshot({ path: 'orion-poster.png' });
await b.close();
