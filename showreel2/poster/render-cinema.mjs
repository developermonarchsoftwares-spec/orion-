import { chromium } from '../../node_modules/playwright/index.mjs';
const b = await chromium.launch({ channel: 'chrome' });
const p = await b.newPage({ viewport: { width: 1800, height: 2400 } });
await p.goto('file:///D:/ownus/showreel2/poster/cinema.html', { waitUntil: 'networkidle' });
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(1200);
await p.screenshot({ path: 'orion-cinematic-poster.png' });
await b.close();
