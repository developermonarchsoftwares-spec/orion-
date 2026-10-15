#!/usr/bin/env node
/**
 * Load / stress test with no dependencies (Node 18+). Fires GET requests at a fixed concurrency for a fixed time, then checks thresholds.
 * Exit code 1 when a threshold is breached, so it can gate a release.
 *
 *   node ops/testing/load-test.mjs --url http://localhost:4000 --paths /api/v1/health,/api/v1/health/ready \
 *        --concurrency 20 --duration 30 --p95 500 --max-error-rate 1
 *
 *   --ramp <s>       linearly add workers over this many seconds (stress / ramp-up), default 0
 *   --token <jwt>    sends Authorization: Bearer (or env LOAD_TOKEN) for authenticated paths
 *   --allow-remote   REQUIRED to target anything but localhost/127.0.0.1/::1 or *.localhost/*.test, so it can't be pointed at production by accident.
 *                    Only ever use against an environment you own and have approved for load; the app's own rate limiter will (correctly) answer 429.
 *   --json           print the result as JSON
 */
import { performance } from 'node:perf_hooks';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
    return acc;
  }, []),
);
const base = String(args.url ?? 'http://localhost:4000').replace(/\/$/, '');
const paths = String(args.paths ?? '/api/v1/health').split(',').map((p) => p.trim()).filter(Boolean);
const concurrency = Number(args.concurrency ?? 10);
const durationS = Number(args.duration ?? 15);
const rampS = Number(args.ramp ?? 0);
const p95Limit = Number(args.p95 ?? 800);
const errLimit = Number(args['max-error-rate'] ?? 1); // percent
const token = args.token && args.token !== true ? args.token : process.env.LOAD_TOKEN;

const host = new URL(base).hostname;
const local = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(host) || /\.(localhost|test)$/.test(host);
if (!local && !args['allow-remote']) {
  console.error(`Refusing to load-test ${host}: not a local address. Pass --allow-remote only for an environment you own and have approved for load testing.`);
  process.exit(2);
}

for (const p of paths) {
  try { new URL(base + p); } catch { console.error(`Invalid path "${p}" (must start with /). In Git Bash on Windows prefix the command with MSYS_NO_PATHCONV=1, or use PowerShell.`); process.exit(2); }
}

const latencies = [];
const statuses = new Map();
let errors = 0;
let sent = 0;
const start = performance.now();
const end = start + durationS * 1000;

async function worker(id) {
  const delay = rampS > 0 ? (id / concurrency) * rampS * 1000 : 0;
  if (delay) await new Promise((r) => setTimeout(r, delay));
  let i = id;
  while (performance.now() < end) {
    const url = base + paths[i++ % paths.length];
    const t = performance.now();
    try {
      const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(15000) });
      await res.arrayBuffer();
      latencies.push(performance.now() - t);
      statuses.set(res.status, (statuses.get(res.status) ?? 0) + 1);
      if (res.status >= 500) errors++;
    } catch (e) {
      errors++;
      const why = e?.cause?.code ?? e?.name ?? 'network';
      statuses.set(why, (statuses.get(why) ?? 0) + 1);
    }
    sent++;
  }
}

await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i)));

const elapsed = (performance.now() - start) / 1000;
latencies.sort((a, b) => a - b);
const pct = (p) => (latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))] : NaN);
const result = {
  target: base,
  paths,
  concurrency,
  durationSeconds: Number(elapsed.toFixed(1)),
  requests: sent,
  rps: Number((sent / elapsed).toFixed(1)),
  errorRatePercent: Number(((errors / Math.max(1, sent)) * 100).toFixed(2)),
  statuses: Object.fromEntries(statuses),
  latencyMs: { min: +pct(0).toFixed(1), p50: +pct(50).toFixed(1), p95: +pct(95).toFixed(1), p99: +pct(99).toFixed(1), max: +latencies[latencies.length - 1]?.toFixed(1) },
};
const failures = [];
if (!(result.latencyMs.p95 <= p95Limit)) failures.push(`p95 ${result.latencyMs.p95} ms > ${p95Limit} ms`);
if (result.errorRatePercent > errLimit) failures.push(`error rate ${result.errorRatePercent}% > ${errLimit}%`);
if (!latencies.length) failures.push('no successful responses');

if (args.json) console.log(JSON.stringify({ ...result, failures }, null, 2));
else {
  console.log(`Load test ${base}  ${concurrency} workers  ${result.durationSeconds}s`);
  console.log(`  requests ${result.requests} (${result.rps}/s)  errors ${result.errorRatePercent}%  statuses ${JSON.stringify(result.statuses)}`);
  console.log(`  latency ms  p50 ${result.latencyMs.p50}  p95 ${result.latencyMs.p95}  p99 ${result.latencyMs.p99}  max ${result.latencyMs.max}`);
  console.log(failures.length ? `FAIL: ${failures.join('; ')}` : `PASS (p95 <= ${p95Limit} ms, errors <= ${errLimit}%)`);
}
process.exit(failures.length ? 1 : 0);
