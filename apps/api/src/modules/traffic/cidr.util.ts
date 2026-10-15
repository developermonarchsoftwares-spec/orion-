import * as net from 'net';

/**
 * IPv4 / IPv6 address and CIDR handling. Addresses are compared as BigInts so IPv6 and IPv4 use the same code. An IPv4 address written
 * as IPv4-mapped IPv6 (::ffff:1.2.3.4, which is how Node reports an IPv4 client on a dual-stack socket) is normalised to plain IPv4.
 */
export interface IParsedAddress {
  version: 4 | 6;
  value: bigint;
}

export function normalizeIp(raw: string | undefined | null): string {
  let ip = String(raw ?? '').trim().toLowerCase();
  if (ip.startsWith('[') && ip.endsWith(']')) ip = ip.slice(1, -1);
  const zone = ip.indexOf('%');
  if (zone !== -1) ip = ip.slice(0, zone);
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (mapped) return mapped[1];
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return ip;
}

function v6ToBigInt(ip: string): bigint | null {
  let s = ip;
  // embedded IPv4 tail (::1.2.3.4 forms)
  const tail = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (tail) {
    const o = tail[1].split('.').map(Number);
    if (o.some((n) => n > 255)) return null;
    s = s.slice(0, s.length - tail[1].length) + ((o[0] << 8) | o[1]).toString(16) + ':' + ((o[2] << 8) | o[3]).toString(16);
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - rest.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0 || (halves.length === 2 && missing < 1)) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...rest];
  if (groups.length !== 8) return null;
  let v = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    v = (v << 16n) | BigInt(parseInt(g, 16));
  }
  return v;
}

export function parseIp(raw: string | undefined | null): IParsedAddress | null {
  const ip = normalizeIp(raw);
  if (net.isIPv4(ip)) {
    const o = ip.split('.').map(Number);
    return { version: 4, value: (BigInt(o[0]) << 24n) | (BigInt(o[1]) << 16n) | (BigInt(o[2]) << 8n) | BigInt(o[3]) };
  }
  if (net.isIPv6(ip)) {
    const v = v6ToBigInt(ip);
    return v === null ? null : { version: 6, value: v };
  }
  return null;
}

export interface IParsedCidr {
  version: 4 | 6;
  network: bigint;
  prefix: number;
  /** Canonical text, e.g. 10.0.0.0/8; a single address is /32 or /128. */
  text: string;
}

/** `203.0.113.7`, `203.0.113.0/24`, `2001:db8::/32`. Host bits below the prefix are cleared. Returns null for anything else. */
export function parseCidr(raw: string): IParsedCidr | null {
  const [addr, len, ...extra] = String(raw ?? '').trim().split('/');
  if (extra.length) return null;
  const a = parseIp(addr);
  if (!a) return null;
  const max = a.version === 4 ? 32 : 128;
  let prefix = max;
  if (len !== undefined) {
    if (!/^\d{1,3}$/.test(len)) return null;
    prefix = Number(len);
    if (prefix > max) return null;
  }
  const hostBits = BigInt(max - prefix);
  const network = (a.value >> hostBits) << hostBits;
  const text = a.version === 4 ? [24n, 16n, 8n, 0n].map((s) => ((network >> s) & 255n).toString()).join('.') : network.toString(16);
  return { version: a.version, network, prefix, text: a.version === 4 ? `${text}/${prefix}` : `${formatV6(network)}/${prefix}` };
}

function formatV6(v: bigint): string {
  const groups: string[] = [];
  for (let i = 7; i >= 0; i--) groups.push(((v >> BigInt(i * 16)) & 0xffffn).toString(16));
  // compress the longest run of zero groups
  let bestStart = -1;
  let bestLen = 0;
  for (let i = 0; i < 8; ) {
    if (groups[i] !== '0') {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === '0') j++;
    if (j - i > bestLen) {
      bestStart = i;
      bestLen = j - i;
    }
    i = j;
  }
  if (bestLen < 2) return groups.join(':');
  return `${groups.slice(0, bestStart).join(':')}::${groups.slice(bestStart + bestLen).join(':')}`;
}

export function ipInCidr(ip: IParsedAddress | null, cidr: IParsedCidr): boolean {
  if (!ip || ip.version !== cidr.version) return false;
  const max = cidr.version === 4 ? 32 : 128;
  const hostBits = BigInt(max - cidr.prefix);
  return (ip.value >> hostBits) << hostBits === cidr.network;
}
