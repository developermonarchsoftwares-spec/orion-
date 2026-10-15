#!/usr/bin/env node
/**
 * Secret scan that never prints a secret value.
 *
 *   node ops/security/scan-secrets.mjs               scan the checked-out tree (tracked and untracked, ignored files excluded),
 *                                                    the git remote URLs, and NEXT_PUBLIC_* names. Exit 1 on any finding.
 *   node ops/security/scan-secrets.mjs --history     also scan every added line in every commit on every branch. Exit 1 on any finding.
 *   node ops/security/scan-secrets.mjs --history --report-only    report history findings, always exit 0 for them.
 *   node ops/security/scan-secrets.mjs --self-test   check the detectors against synthetic values (no repository access).
 *
 * Output lists the finding type, the file, the line and (history) the commit, plus an 8-character fingerprint of the value so that
 * the same secret in several places can be recognised. The value itself is never written. Placeholders (example hosts, "password",
 * "your-...", local hosts, test fixtures) are ignored on purpose.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';

const fp = (s) => createHash('sha256').update(s).digest('hex').slice(0, 8);
const PLACEHOLDER = /(your|change|example|sample|placeholder|xxxx|dummy|fake|redacted|replace|<|>|\$\{|\.\.\.|test|secret|generate|set-me)/i;
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|postgres|db|host\.docker\.internal|[a-z0-9-]*\.(invalid|example|test|localhost))$/i;
const PLACEHOLDER_PW = new Set(['password', 'postgres', 'user', 'pass', 'e2e', 'secret', 'orion', 'admin', 'changeme', 'minioadmin']);

/** Each detector returns [{type, value}] for one line of text. */
const detectors = [
  {
    type: 'database-url-with-password',
    scan: (line) => {
      const out = [];
      for (const m of line.matchAll(/postgres(?:ql)?:\/\/([^:/@\s"'`<>$]+):([^@\s"'`<>$]{6,})@([A-Za-z0-9.-]+)/g)) {
        const [, user, pw, host] = m;
        if (LOCAL_HOST.test(host) || PLACEHOLDER_PW.has(pw.toLowerCase()) || PLACEHOLDER.test(pw) || PLACEHOLDER.test(host)) continue;
        out.push({ type: 'database-url-with-password', value: pw });
      }
      return out;
    },
  },
  {
    // Signing and encryption secrets assigned a long literal value (not an environment reference, not a placeholder).
    type: 'signing-or-encryption-secret-literal',
    scan: (l) => {
      const out = [];
      for (const m of l.matchAll(/\b(JWT_(?:ACCESS|REFRESH)_SECRET|ADMIN_OTP_SECRET|MFA_ENCRYPTION_KEY|INTEGRATIONS_ENCRYPTION_KEY)\b\s*[=:]\s*["']?([A-Za-z0-9+/=_-]{32,})/g)) {
        if (PLACEHOLDER.test(m[2])) continue;
        out.push({ type: 'signing-or-encryption-secret-literal', value: m[2] });
      }
      return out;
    },
  },
  { type: 'managed-postgres-password-prefix', scan: (l) => [...l.matchAll(/\bnpg_[A-Za-z0-9]{8,}\b/g)].map((m) => ({ type: 'managed-postgres-password-prefix', value: m[0] })) },
  { type: 'mail-api-key', scan: (l) => [...l.matchAll(/\bre_[A-Za-z0-9]{24,}\b/g)].filter((m) => !PLACEHOLDER.test(m[0])).map((m) => ({ type: 'mail-api-key', value: m[0] })) },
  { type: 'google-oauth-client-secret', scan: (l) => [...l.matchAll(/\bGOCSPX-[A-Za-z0-9_-]{10,}/g)].map((m) => ({ type: 'google-oauth-client-secret', value: m[0] })) },
  {
    type: 'live-payment-key',
    scan: (l) => [...l.matchAll(/\b(?:rzp_live_|sk_live_)([A-Za-z0-9_]{8,})/g)].filter((m) => !PLACEHOLDER.test(m[1])).map((m) => ({ type: 'live-payment-key', value: m[0] })),
  },
  { type: 'github-token', scan: (l) => [...l.matchAll(/\b(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/g)].map((m) => ({ type: 'github-token', value: m[0] })) },
  { type: 'aws-access-key-id', scan: (l) => [...l.matchAll(/\bAKIA[0-9A-Z]{16}\b/g)].map((m) => ({ type: 'aws-access-key-id', value: m[0] })) },
  { type: 'private-key-block', scan: (l) => (/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/.test(l) ? [{ type: 'private-key-block', value: l.trim() }] : []) },
  { type: 'hosting-oidc-token', scan: (l) => (/^VERCEL_OIDC_TOKEN=["']?eyJ/.test(l) ? [{ type: 'hosting-oidc-token', value: l }] : []) },
];

/** NEXT_PUBLIC_* variables are bundled into browser code, so a secret-looking name there is a leak by construction. */
const PUBLIC_SECRET_NAME = /NEXT_PUBLIC_[A-Z0-9_]*(SECRET|PASSWORD|PRIVATE|TOKEN|DATABASE|API_KEY)/;

export function scanLine(line) {
  const hits = [];
  for (const d of detectors) for (const h of d.scan(line)) hits.push({ type: h.type, fingerprint: fp(h.value) });
  if (PUBLIC_SECRET_NAME.test(line)) hits.push({ type: 'public-variable-with-secret-name', fingerprint: fp(line.match(PUBLIC_SECRET_NAME)[0]) });
  return hits;
}

function selfTest() {
  // Synthetic values are built at run time so this file never contains a secret-shaped literal.
  const pw = ['Zq', '8x', 'Lm', '4v', 'Tk', '2p'].join('');
  const cases = [
    [`DATABASE_URL=postgresql://svc_owner:${pw}@ep-quiet-lake-12345.eu-west-1.aws.neon.tech/app`, 'database-url-with-password', true],
    ['x = "postgresql://user:password@localhost:5432/db"', 'database-url-with-password', false],
    ['x = "postgresql://user:Abcdef12345@ep-sample-host.neon.tech/db"', 'database-url-with-password', false],
    [`token = ${['npg', '_', 'AbCdEf12GhIj'].join('')}`, 'managed-postgres-password-prefix', true],
    [`JWT_ACCESS_SECRET: ${'Qx7'.repeat(14)}`, 'signing-or-encryption-secret-literal', true],
    ['JWT_ACCESS_SECRET: "${JWT_ACCESS_SECRET:?set it}"', 'signing-or-encryption-secret-literal', false],
    ['JWT_REFRESH_SECRET=generate_a_secure_64_char_random_string_here_please', 'signing-or-encryption-secret-literal', false],
    [`KEY=${['rzp', '_live_', 'Ab12Cd34Ef56Gh'].join('')}`, 'live-payment-key', true],
    [`KEY=${['rzp', '_live_', 'testkeyid0001'].join('')}`, 'live-payment-key', false],
    [`NEXT_PUBLIC_${'API'}_${'TOKEN'}=abc`, 'public-variable-with-secret-name', true],
    ['NEXT_PUBLIC_API_URL=http://localhost:4000', 'public-variable-with-secret-name', false],
  ];
  let failed = 0;
  for (const [line, type, expected] of cases) {
    const got = scanLine(line).some((h) => h.type === type);
    if (got !== expected) { failed++; console.error(`self-test FAIL: expected ${type}=${expected}, got ${got}`); }
  }
  console.log(failed ? `self-test: ${failed} failure(s)` : `self-test: ${cases.length} cases passed`);
  return failed === 0;
}

const git = (args, opts = {}) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, ...opts });
const SKIP_FILE = /(^|\/)(node_modules|\.next|dist|\.turbo|playwright-report|test-results)\/|(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$|\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|woff2?|ttf|mp4|mov|webm)$/i;

function scanWorkingTree() {
  const files = git(['ls-files', '--cached', '--others', '--exclude-standard']).split('\n').filter(Boolean);
  const out = [];
  for (const f of files) {
    if (SKIP_FILE.test(f)) continue;
    let text;
    try {
      if (statSync(f).size > 2_000_000) continue;
      text = readFileSync(f, 'utf8');
    } catch { continue; }
    text.split(/\r?\n/).forEach((line, i) => {
      for (const h of scanLine(line)) out.push({ where: 'working-tree', file: f, line: i + 1, ...h });
    });
  }
  return out;
}

function scanRemotes() {
  const out = [];
  let cfg = '';
  try { cfg = git(['config', '--get-regexp', '^remote\\..*\\.(url|pushurl)$']); } catch { return out; }
  for (const l of cfg.split('\n').filter(Boolean)) {
    const [key, url] = [l.slice(0, l.indexOf(' ')), l.slice(l.indexOf(' ') + 1)];
    const m = /^https?:\/\/([^/@\s]+)@/.exec(url);
    if (m) out.push({ where: 'git-config', file: key, line: 0, type: 'git-remote-url-embeds-credentials', fingerprint: fp(m[1]) });
  }
  return out;
}

function scanHistory() {
  const res = spawnSync('git', ['log', '--all', '-p', '--no-color', '--format=%x00commit %h', '--', '.', ':!**/package-lock.json'], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 });
  if (res.status !== 0) throw new Error('git log failed');
  const out = [];
  const seen = new Set();
  let commit = '?';
  let file = '?';
  for (const line of res.stdout.split('\n')) {
    if (line.startsWith('\u0000commit ')) { commit = line.slice(8).trim(); continue; }
    if (line.startsWith('+++ b/')) { file = line.slice(6); continue; }
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    if (SKIP_FILE.test(file)) continue;
    for (const h of scanLine(line.slice(1))) {
      const key = `${commit}|${file}|${h.type}|${h.fingerprint}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ where: `history:${commit}`, file, line: 0, ...h });
    }
  }
  return out;
}

function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has('--self-test')) process.exit(selfTest() ? 0 : 1);
  const wt = [...scanWorkingTree(), ...scanRemotes()];
  const hist = args.has('--history') ? scanHistory() : [];
  const print = (list) => list.forEach((f) => console.log(`  [${f.type}] ${f.file}${f.line ? ':' + f.line : ''} (${f.where}) fingerprint=${f.fingerprint}`));
  console.log(`working tree and git config: ${wt.length} finding(s)`);
  print(wt);
  if (args.has('--history')) {
    console.log(`git history (all branches): ${hist.length} finding(s)`);
    print(hist);
    const distinct = new Set(hist.filter((h) => h.type !== 'git-remote-url-embeds-credentials').map((h) => h.fingerprint));
    console.log(`  distinct secret values in history: ${distinct.size}`);
  }
  console.log('Values are never printed. A history finding stays valid until the secret is rotated, even after the history is cleaned.');
  const fail = wt.length > 0 || (hist.length > 0 && !args.has('--report-only'));
  process.exit(fail ? 1 : 0);
}

main();
