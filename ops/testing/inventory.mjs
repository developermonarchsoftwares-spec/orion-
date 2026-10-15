#!/usr/bin/env node
/** Prints how many test files exist per class, so the classification stays visible. `--check` exits 1 if a file matches no class. */
import { execFileSync } from 'node:child_process';

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\n').filter(Boolean);
const classes = [
  ['unit', (f) => /^(apps\/api\/src|ownus\/src)\/.*\.(spec|test)\.tsx?$/.test(f) && !/\.(integration|perf|security|regression)\.spec\.ts$/.test(f) && !/\/database\/__tests__\//.test(f)],
  ['integration', (f) => /^apps\/api\/src\/.*(\.integration\.spec\.ts|database\/__tests__\/.*\.spec\.ts)$/.test(f)],
  ['security', (f) => /\.security\.spec\.ts$/.test(f) || /security-hardening|admin-authorization|access-model/.test(f)],
  ['performance', (f) => /\.perf\.spec\.ts$/.test(f)],
  ['regression', (f) => /\.regression\.spec\.ts$/.test(f)],
  ['e2e-api', (f) => /^apps\/api\/test\/.*\.e2e-spec\.ts$/.test(f)],
  ['e2e-browser', (f) => /^tests\/.*\.spec\.ts$/.test(f)],
  ['load', (f) => /^ops\/testing\/load-test\.mjs$/.test(f)],
];
const any = files.filter((f) => /\.(spec|test|e2e-spec)\.tsx?$/.test(f) && !/node_modules/.test(f));
const counts = {};
for (const [name, test] of classes) counts[name] = files.filter(test).length;
console.table(counts);
const unclassified = any.filter((f) => !classes.some(([, t]) => t(f)));
if (unclassified.length) console.log('Not matched by any class:\n  ' + unclassified.join('\n  '));
if (process.argv.includes('--check') && unclassified.length) process.exit(1);
