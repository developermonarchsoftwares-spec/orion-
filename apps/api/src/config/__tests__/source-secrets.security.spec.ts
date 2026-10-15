import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Security test: no live credentials in version-controlled source. Scans every tracked text file (not docs, which describe past incidents,
 * and not lock files). Patterns are high-confidence on purpose so a failure is a real finding, not noise.
 * Placeholders (CHANGE_ME, your-, example, xxxx, <...>, ${...}) are allowed.
 */
const ROOT = path.resolve(__dirname, '../../../../..');
const SKIP = /(^|\/)(node_modules|dist|\.next|playwright-report|test-results|brag-output[^/]*|showreel2?|docs|scratch)\//;
const SKIP_FILE = /(package-lock\.json|\.(png|jpe?g|gif|webp|ico|mp4|woff2?|pdf|zip|lock|tsbuildinfo|map)|\.spec\.ts|\.test\.ts|\.e2e-spec\.ts)$/;
const PLACEHOLDER = /(change[_-]?me|your[_-]|example|xxxx|placeholder|dummy|test|<[^>]+>|\$\{[^}]+\}|\*{3,}|password|secret|user:pass|username)/i;

const RULES: { name: string; re: RegExp; allow?: (m: string) => boolean }[] = [
  { name: 'private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Stripe / Razorpay live secret', re: /\b(?:sk_live_|rzp_live_)[A-Za-z0-9]{10,}/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  {
    name: 'database URL with an embedded password',
    re: /\bpostgres(?:ql)?:\/\/[^\s:/@'"`]+:([^\s@'"`]+)@[^\s'"`]+/,
    allow: (m) => PLACEHOLDER.test(m) || /localhost|127\.0\.0\.1|\[::1\]/.test(m),
  },
];

describe('no live credentials in tracked source', () => {
  const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\n')
    .filter((f) => f && !SKIP.test(f) && !SKIP_FILE.test(f));

  it('scans a meaningful number of files', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it.each(RULES.map((r) => [r.name, r] as const))('contains no %s', (_name, rule) => {
    const findings: string[] = [];
    for (const f of files) {
      const abs = path.join(ROOT, f);
      let text: string;
      try {
        if (fs.statSync(abs).size > 2 * 1024 * 1024) continue;
        text = fs.readFileSync(abs, 'utf8');
      } catch {
        continue;
      }
      const m = text.match(rule.re);
      if (m && !(rule.allow?.(m[0]) ?? false)) findings.push(`${f} (${rule.name})`); // file name only: never print the value
    }
    expect(findings).toEqual([]);
  });

  it('keeps real environment files out of version control', () => {
    const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n');
    const bad = tracked.filter((f) => /(^|\/)\.env(\.[a-z]+)?$/.test(f) && !/example|sample|template/.test(f));
    expect(bad).toEqual([]);
  });
});
