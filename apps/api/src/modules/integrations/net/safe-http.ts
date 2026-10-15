import * as dns from 'dns';
import * as http from 'http';
import * as https from 'https';
import * as net from 'net';
import { performance } from 'perf_hooks';
import { outboundDuration, outboundErrors } from '../../../common/observability/metrics';
import { withSpan } from '../../../common/observability/tracing';

/**
 * Outbound HTTP for URLs a customer typed in (webhook endpoints). Server-side request forgery is the risk: without these checks a
 * customer could make this server call its own internal network, a cloud metadata service, or localhost. Rules:
 *  - https only (http only when the private-network flag is on, which is refused in production);
 *  - no credentials in the URL, a bounded URL length;
 *  - the hostname is resolved HERE and every address must be public; the connection then uses that same address (no second lookup,
 *    so DNS rebinding cannot swap in a private one); IP-literal hosts are checked directly;
 *  - redirects are never followed (a 3xx is a failure);
 *  - a hard timeout and a cap on how much of the response is read.
 */
export class UnsafeUrlError extends Error {
  constructor(
    message: string,
    readonly code: 'INVALID_URL' | 'UNSAFE_SCHEME' | 'UNSAFE_HOST' | 'UNSAFE_PORT' | 'DNS_FAILED',
  ) {
    super(message);
  }
}

export const MAX_URL_LENGTH = 500;

/**
 * Ports of services that are not web servers. The address check already keeps requests off private networks; this keeps a customer
 * from using Orion's server to probe such services on PUBLIC hosts (port scanning with the delivery log as the answer). Ordinary
 * webhook ports (443, 8443, 8080, 3000 and so on) are untouched.
 */
export const BLOCKED_PORTS: ReadonlySet<number> = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 138, 139,
  143, 161, 179, 389, 427, 445, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1080, 1433, 1434, 1521, 1723,
  2049, 2375, 2376, 3128, 3306, 3389, 4369, 5060, 5061, 5432, 5672, 5900, 5984, 6000, 6379, 6667, 6697, 9042, 9092, 9200, 9300, 10000, 11211, 15672, 27017, 27018, 50000,
]);

/** Only for local development and tests; never honoured when NODE_ENV=production. */
export function privateNetworkAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== 'production' && env.INTEGRATIONS_ALLOW_PRIVATE_NETWORK === 'true';
}

const v4 = (ip: string) => ip.split('.').map(Number);
const inV4 = (n: number[], a: number, b: number) => n[0] === a && n[1] >= b;

/** True for any address that is not a normal public unicast address. */
export function isBlockedAddress(address: string): boolean {
  let ip = address.trim().toLowerCase();
  if (ip.startsWith('[') && ip.endsWith(']')) ip = ip.slice(1, -1);
  const zone = ip.indexOf('%');
  if (zone !== -1) ip = ip.slice(0, zone);

  if (net.isIPv4(ip)) {
    const n = v4(ip);
    if (n[0] === 0 || n[0] === 10 || n[0] === 127) return true; // this-network, private, loopback
    if (n[0] === 100 && n[1] >= 64 && n[1] <= 127) return true; // carrier-grade NAT
    if (n[0] === 169 && n[1] === 254) return true; // link-local, includes the cloud metadata address
    if (n[0] === 172 && n[1] >= 16 && n[1] <= 31) return true;
    if (n[0] === 192 && n[1] === 0 && n[2] === 0) return true; // IETF protocol assignments
    if (n[0] === 192 && n[1] === 0 && n[2] === 2) return true; // documentation
    if (n[0] === 192 && n[1] === 88 && n[2] === 99) return true; // deprecated 6to4 relay anycast
    if (n[0] === 192 && n[1] === 31 && n[2] === 196) return true; // AS112
    if (n[0] === 192 && n[1] === 52 && n[2] === 193) return true; // AS112 (RFC 7535)
    if (n[0] === 192 && n[1] === 175 && n[2] === 48) return true; // AS112 direct delegation
    if (n[0] === 192 && n[1] === 168) return true;
    if (n[0] === 198 && (n[1] === 18 || n[1] === 19)) return true; // benchmarking
    if (n[0] === 198 && n[1] === 51 && n[2] === 100) return true;
    if (n[0] === 203 && n[1] === 0 && n[2] === 113) return true;
    if (n[0] >= 224) return true; // multicast, reserved, broadcast
    return false;
  }

  if (net.isIPv6(ip)) {
    // Judged on the eight 16-bit groups, never on the spelling: `0:0:0:0:0:0:0:1`, `::1` and `0000::0001` are one address, and an
    // IPv4 address can hide inside an IPv6 one in several ways (mapped, compatible, NAT64, 6to4).
    const g = parseIPv6Groups(ip);
    if (!g) return true; // cannot be understood: never connect
    const embedded = (hi: number, lo: number) => isBlockedAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    const zero = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);
    if (zero(0, 5) && g[5] === 0xffff) return embedded(g[6], g[7]); // ::ffff:0:0/96 IPv4-mapped
    if (zero(0, 4) && g[4] === 0xffff && g[5] === 0) return embedded(g[6], g[7]); // ::ffff:0:0:0/96 IPv4-translated (SIIT)
    if (zero(0, 6)) return true; // ::/96: unspecified, loopback and the deprecated IPv4-compatible form (::a.b.c.d)
    if (g[0] === 0x64 && g[1] === 0xff9b) {
      if (zero(2, 6)) return embedded(g[6], g[7]); // 64:ff9b::/96 NAT64 well-known prefix
      if (g[2] === 1) return true; // 64:ff9b:1::/48 local-use NAT64
    }
    if (g[0] === 0x2002) return embedded(g[1], g[2]); // 2002::/16 6to4: judged as the IPv4 address it carries
    if (g[0] === 0x2001 && g[1] === 0) return true; // 2001::/32 Teredo
    if (g[0] === 0x2001 && g[1] === 0xdb8) return true; // 2001:db8::/32 documentation
    if (g[0] === 0x3fff && (g[1] & 0xf000) === 0) return true; // 3fff::/20 documentation
    if (g[0] === 0x100 && zero(1, 4)) return true; // 100::/64 discard-only
    if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 deprecated site-local
    if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
    return false;
  }
  return true; // not an IP at all: never connect
}

/** The eight 16-bit groups of a valid IPv6 address (any spelling, including `::` compression and a dotted IPv4 tail), else null. */
export function parseIPv6Groups(ip: string): number[] | null {
  let s = ip;
  const lastColon = s.lastIndexOf(':');
  if (s.includes('.')) {
    const v4 = s.slice(lastColon + 1);
    if (!net.isIPv4(v4)) return null;
    const p = v4.split('.').map(Number);
    s = `${s.slice(0, lastColon + 1)}${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 1 ? fill !== 0 : fill < 1) return null;
  const groups = [...head, ...new Array(fill).fill('0'), ...tail];
  if (groups.length !== 8 || !groups.every((x) => /^[0-9a-f]{1,4}$/i.test(x))) return null;
  return groups.map((x) => parseInt(x, 16));
}

/** Syntax and scheme checks only (no network). Returns the parsed URL. */
export function parseTargetUrl(raw: string, env: NodeJS.ProcessEnv = process.env): URL {
  if (typeof raw !== 'string' || !raw || raw.length > MAX_URL_LENGTH) throw new UnsafeUrlError('The URL is missing or too long', 'INVALID_URL');
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new UnsafeUrlError('The URL is not valid', 'INVALID_URL');
  }
  const allowPrivate = privateNetworkAllowed(env);
  if (u.protocol !== 'https:' && !(allowPrivate && u.protocol === 'http:')) throw new UnsafeUrlError('Only https URLs are allowed', 'UNSAFE_SCHEME');
  if (u.username || u.password) throw new UnsafeUrlError('The URL must not contain credentials', 'INVALID_URL');
  if (!u.hostname) throw new UnsafeUrlError('The URL has no host', 'INVALID_URL');
  if (u.port && BLOCKED_PORTS.has(Number(u.port)) && !allowPrivate) throw new UnsafeUrlError('That port is not allowed', 'UNSAFE_PORT');
  return u;
}

const lookupAll = (host: string): Promise<dns.LookupAddress[]> => dns.promises.lookup(host, { all: true, verbatim: true });

/** Resolves and checks the host. Throws UnsafeUrlError unless every resolved address is public (or the private flag is on). */
export async function assertSafeUrl(raw: string, env: NodeJS.ProcessEnv = process.env): Promise<URL> {
  const u = parseTargetUrl(raw, env);
  if (privateNetworkAllowed(env)) return u;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    if (isBlockedAddress(host)) throw new UnsafeUrlError('That address is not allowed', 'UNSAFE_HOST');
    return u;
  }
  let addrs: dns.LookupAddress[];
  try {
    addrs = await lookupAll(host);
  } catch {
    throw new UnsafeUrlError('The host name could not be resolved', 'DNS_FAILED');
  }
  if (!addrs.length || addrs.some((a) => isBlockedAddress(a.address))) throw new UnsafeUrlError('That address is not allowed', 'UNSAFE_HOST');
  return u;
}

export interface ISafeRequestOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  /** Most response bytes read; the rest is dropped. */
  maxBytes?: number;
  env?: NodeJS.ProcessEnv;
  /** Low-cardinality label for the outbound metrics (`webhook`, `alert-webhook`, ...). Never a customer-supplied value. */
  target?: string;
}

export interface ISafeResponse {
  status: number;
  body: string;
  durationMs: number;
}

/**
 * One request, no redirects. The connection address comes from OUR validated lookup, so the address checked is the address used.
 * Rejects with UnsafeUrlError for a blocked target, or Error('timeout' | network error) otherwise.
 */
export async function safeRequest(raw: string, opts: ISafeRequestOptions = {}): Promise<ISafeResponse> {
  const target = opts.target ?? 'webhook';
  let host = 'unknown';
  try {
    host = new URL(raw).host;
  } catch {
    /* an invalid URL is rejected below */
  }
  const t0 = performance.now();
  return withSpan(
    'http.client',
    { 'http.method': opts.method ?? 'POST', 'net.peer.name': host, 'orion.target': target },
    async (span) => {
      try {
        const res = await performRequest(raw, opts);
        outboundDuration.observe({ target }, (performance.now() - t0) / 1000);
        if (res.status >= 500) outboundErrors.inc({ target });
        if (span) span.attributes['http.status_code'] = res.status;
        return res;
      } catch (err) {
        outboundDuration.observe({ target }, (performance.now() - t0) / 1000);
        outboundErrors.inc({ target });
        throw err;
      }
    },
    'CLIENT',
  );
}

async function performRequest(raw: string, opts: ISafeRequestOptions = {}): Promise<ISafeResponse> {
  const env = opts.env ?? process.env;
  const u = parseTargetUrl(raw, env);
  const allowPrivate = privateNetworkAllowed(env);
  const timeoutMs = opts.timeoutMs ?? 8000;
  const maxBytes = opts.maxBytes ?? 64 * 1024;
  const started = Date.now();
  // Node does not call a custom `lookup` for an IP-literal host (it connects straight to it), so a literal is checked here.
  const literalHost = u.hostname.replace(/^\[|\]$/g, '');
  if (!allowPrivate && net.isIP(literalHost) && isBlockedAddress(literalHost)) throw new UnsafeUrlError('That address is not allowed', 'UNSAFE_HOST');

  const guardedLookup = (hostname: string, options: any, cb: any) => {
    const done = (err: Error | null, address?: string, family?: number) => (options?.all ? cb(err, address ? [{ address, family }] : []) : cb(err, address, family));
    const literal = hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(literal)) return done(allowPrivate || !isBlockedAddress(literal) ? null : new UnsafeUrlError('That address is not allowed', 'UNSAFE_HOST'), literal, net.isIPv6(literal) ? 6 : 4);
    lookupAll(literal).then(
      (addrs) => {
        const pick = addrs.find((a) => allowPrivate || !isBlockedAddress(a.address));
        if (!addrs.length || (!allowPrivate && addrs.some((a) => isBlockedAddress(a.address))) || !pick) return done(new UnsafeUrlError('That address is not allowed', 'UNSAFE_HOST'));
        return done(null, pick.address, pick.family);
      },
      () => done(new UnsafeUrlError('The host name could not be resolved', 'DNS_FAILED')),
    );
  };

  return new Promise((resolve, reject) => {
    const lib = u.protocol === 'http:' ? http : https;
    const body = opts.body ?? '';
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname.replace(/^\[|\]$/g, ''),
        port: u.port || undefined,
        path: `${u.pathname}${u.search}`,
        method: opts.method ?? 'POST',
        headers: { ...(opts.headers ?? {}), ...(body ? { 'content-length': String(Buffer.byteLength(body)) } : {}) },
        lookup: guardedLookup as any,
        agent: false, // no connection reuse across customers
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8'), durationMs: Date.now() - started });
        };
        res.on('data', (c: Buffer) => {
          if (size < maxBytes) chunks.push(c.subarray(0, maxBytes - size));
          size += c.length;
          // Enough has been read: close the connection instead of downloading the rest of an endless or huge response.
          if (size >= maxBytes) {
            finish();
            res.destroy();
          }
        });
        res.on('end', finish);
        res.on('close', finish);
        res.on('error', (e) => (settled ? undefined : reject(e)));
      },
    );
    const timer = setTimeout(() => req.destroy(new Error('timeout')), timeoutMs);
    req.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    req.on('close', () => clearTimeout(timer));
    if (body) req.write(body);
    req.end();
  });
}
