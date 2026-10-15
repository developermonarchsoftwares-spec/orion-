import { chromium } from '../node_modules/playwright/index.mjs';
const b = await chromium.launch({ channel: 'chrome' });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
p.on('pageerror', e => console.log('ERR', e.message));
await p.goto('file:///D:/ownus/showreel2/composition/index.html');
await p.waitForTimeout(1500);
console.log(await p.evaluate(() => { const tl = window.__timelines.main; tl.seek(14.2); const s = document.querySelector('#s5'); const cs = getComputedStyle(s); return { dur: tl.duration(), op: cs.opacity, disp: cs.display, vis: cs.visibility, tag: getComputedStyle(document.querySelector('#tag5')).opacity, rect: JSON.stringify(s.getBoundingClientRect()) }; }));
await b.close();
