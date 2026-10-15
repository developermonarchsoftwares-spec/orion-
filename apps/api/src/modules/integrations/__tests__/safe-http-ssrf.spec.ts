import * as dns from 'dns';
import { EventEmitter } from 'events';
import * as http from 'http';
import * as https from 'https';
import { AddressInfo } from 'net';
import { assertSafeUrl, BLOCKED_PORTS, isBlockedAddress, parseIPv6Groups, parseTargetUrl, safeRequest, UnsafeUrlError } from '../net/safe-http';

/**
 * Phase 8: SSRF controls beyond the basics in safe-http.spec.ts. DNS is always mocked; no test contacts an external host, a cloud
 * metadata service or an internal network. The only sockets opened are to a loopback server this file starts.
 */
// `import * as https` makes a private copy of the module, so a spy on it would never see the production call; a module mock does.
jest.mock('https', () => {
  const actual = jest.requireActual('https');
  return { ...actual, request: jest.fn(actual.request) };
});

const strict = { NODE_ENV: 'test' } as unknown as NodeJS.ProcessEnv;
const dev = { NODE_ENV: 'test', INTEGRATIONS_ALLOW_PRIVATE_NETWORK: 'true' } as unknown as NodeJS.ProcessEnv;
const answer = (...addresses: string[]) => addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));

describe('address classification: IPv6 judged by value, not by spelling', () => {
  it.each([
    // the same loopback / unspecified / mapped addresses written the long way
    '0:0:0:0:0:0:0:1', '0000:0000:0000:0000:0000:0000:0000:0001', '0:0:0:0:0:0:0:0', '::0',
    '0:0:0:0:0:ffff:7f00:1', '0000:0000:0000:0000:0000:ffff:127.0.0.1', '::ffff:127.0.0.1', '::FFFF:7F00:1',
    // IPv4 hidden in other IPv6 forms
    '::7f00:1', '::127.0.0.1', '::a9fe:a9fe', '::ffff:0:7f00:1', '::ffff:0:10.0.0.1',
    '64:ff9b::7f00:1', '64:ff9b::10.0.0.1', '64:ff9b:1::1', '64:ff9b:1::7f00:1',
    '2002:7f00:1::', '2002:a9fe:a9fe::1', '2002:a00:1::', '2002:c0a8:101::5',
    // special-use ranges
    '2001:0:4136:e378:8000:63bf:3fff:fdd2', '2001:db8::1', '3fff::1', '100::1', 'fec0::1', 'FEC0::1', 'fe80::1', 'FE80::ABCD', 'fc00::1', 'fd00:ec2::254', 'ff02::1',
    // IPv4 special-use ranges added in Phase 8
    '192.88.99.1', '192.31.196.5', '192.52.193.1', '192.175.48.9',
  ])('blocks %s', (ip) => expect(isBlockedAddress(ip)).toBe(true));

  it.each([
    '2606:4700:4700::1111', '2001:4860:4860::8888', '2a00:1450:4001:81b::200e', '2620:fe::fe',
    '::ffff:8.8.8.8', '::ffff:0808:0808', '0:0:0:0:0:ffff:808:808', '::ffff:0:8.8.8.8', '64:ff9b::808:808', '2002:808:808::1',
    '8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.255.255', '172.32.0.1', '192.88.98.1', '192.88.100.1',
  ])('allows the public address %s', (ip) => expect(isBlockedAddress(ip)).toBe(false));

  it('treats anything it cannot parse as blocked (fail closed)', () => {
    for (const bad of ['', ' ', 'localhost', 'example.com', '1.2.3', '1.2.3.4.5', '256.1.1.1', ':::', '1::2::3', 'g::1', '12345::1', '1:2:3:4:5:6:7:8:9', '::ffff:1.2.3', '[::1', 'http://127.0.0.1']) {
      expect({ bad, blocked: isBlockedAddress(bad) }).toEqual({ bad, blocked: true });
    }
  });

  it('parseIPv6Groups gives eight groups for every spelling of one address', () => {
    const one = [0, 0, 0, 0, 0, 0, 0, 1];
    for (const s of ['::1', '0:0:0:0:0:0:0:1', '0000:0000:0000:0000:0000:0000:0000:0001', '::0001', '0::1']) expect(parseIPv6Groups(s)).toEqual(one);
    expect(parseIPv6Groups('::ffff:127.0.0.1')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]);
    expect(parseIPv6Groups('1:2:3:4:5:6:7::')).toEqual([1, 2, 3, 4, 5, 6, 7, 0]);
    expect(parseIPv6Groups('1::')).toEqual([1, 0, 0, 0, 0, 0, 0, 0]);
    expect(parseIPv6Groups('1:2:3:4:5:6:7:8:9')).toBeNull();
  });
});

describe('URL validation before any request', () => {
  it.each([
    ['loopback IPv4', 'https://127.0.0.1/'],
    ['private IPv4', 'https://192.168.1.10/hook'],
    ['link-local / cloud metadata', 'https://169.254.169.254/latest/meta-data/iam/'],
    ['metadata with credentials-style path', 'https://169.254.169.254:443/computeMetadata/v1/'],
    ['loopback IPv6', 'https://[::1]/'],
    ['private IPv6', 'https://[fd00::1]/'],
    ['IPv4-mapped IPv6', 'https://[::ffff:127.0.0.1]/'],
    ['IPv4-mapped IPv6, hex', 'https://[::ffff:7f00:1]/'],
    ['IPv6 written the long way', 'https://[0:0:0:0:0:0:0:1]/'],
    ['IPv4-compatible IPv6', 'https://[::7f00:1]/'],
    ['6to4 carrying 127.0.0.1', 'https://[2002:7f00:1::]/'],
    ['6to4 carrying the metadata address', 'https://[2002:a9fe:a9fe::1]/'],
    ['Teredo', 'https://[2001:0:4136:e378:8000:63bf:3fff:fdd2]/'],
    ['site-local IPv6', 'https://[fec0::1]/'],
    ['decimal integer IP', 'https://2130706433/'],
    ['hexadecimal IP', 'https://0x7f000001/'],
    ['octal IP', 'https://017700000001/'],
    ['dotted hex IP', 'https://0x7f.0x0.0x0.0x1/'],
    ['short IP form', 'https://127.1/'],
    ['all-zero IP', 'https://0.0.0.0/'],
    ['10/8 as an integer', 'https://167772161/'],
    ['metadata as an integer', 'https://2852039166/'],
    ['trailing-dot IP', 'https://127.0.0.1./'],
  ])('refuses %s without a DNS lookup', async (_label, url) => {
    const lookup = jest.spyOn(dns.promises, 'lookup');
    await expect(assertSafeUrl(url, strict)).rejects.toMatchObject({ code: 'UNSAFE_HOST' });
    expect(lookup).not.toHaveBeenCalled();
    lookup.mockRestore();
  });

  it('refuses unsupported schemes, credentials, malformed URLs and over-long URLs', () => {
    for (const bad of ['ftp://example.com/', 'gopher://example.com/', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,x', 'http://example.com/', 'ws://example.com/', 'dict://example.com:11211/', 'ldap://example.com/']) {
      expect(() => parseTargetUrl(bad, strict)).toThrow(UnsafeUrlError);
    }
    expect(() => parseTargetUrl('https://user:pass@example.com/', strict)).toThrow(/credentials/);
    expect(() => parseTargetUrl('https://:pass@example.com/', strict)).toThrow(/credentials/);
    expect(() => parseTargetUrl('https://example.com@evil.example/', strict)).toThrow(/credentials/);
    for (const bad of ['', 'https://', 'https://exa mple.com/', 'https://exa\u0000mple.com/', 'not a url', 'https://example.com:99999/']) {
      expect(() => parseTargetUrl(bad, strict)).toThrow(UnsafeUrlError);
    }
    expect(() => parseTargetUrl(`https://example.com/${'a'.repeat(600)}`, strict)).toThrow(/too long/);
  });

  it('handles internationalised host names consistently (the URL parser converts them before any check)', () => {
    expect(parseTargetUrl('https://bücher.example/hook', strict).hostname).toBe('xn--bcher-kva.example');
    expect(parseTargetUrl('https://ＥＸＡＭＰＬＥ.com/', strict).hostname).toBe('example.com');
  });

  it('refuses ports of non-web services on public hosts, and keeps ordinary webhook ports', () => {
    for (const port of [22, 25, 445, 3306, 5432, 6379, 9200, 11211, 27017]) {
      expect({ port, blocked: BLOCKED_PORTS.has(port) }).toEqual({ port, blocked: true });
      expect(() => parseTargetUrl(`https://example.com:${port}/x`, strict)).toThrow(expect.objectContaining({ code: 'UNSAFE_PORT' }));
    }
    for (const url of ['https://example.com/x', 'https://example.com:443/x', 'https://example.com:8443/x', 'https://example.com:8080/x', 'https://example.com:3000/x', 'https://example.com:9443/x']) {
      expect(parseTargetUrl(url, strict).hostname).toBe('example.com');
    }
    // the development flag (refused in production) keeps loopback test servers on any port working
    expect(parseTargetUrl('http://127.0.0.1:6379/x', dev).port).toBe('6379');
  });
});

describe('destination checks with mocked DNS', () => {
  afterEach(() => jest.restoreAllMocks());
  const mockDns = (...results: Array<ReturnType<typeof answer> | Error>) => {
    const spy = jest.spyOn(dns.promises, 'lookup');
    for (const r of results) r instanceof Error ? spy.mockRejectedValueOnce(r) : spy.mockResolvedValueOnce(r as any);
    return spy;
  };

  it('accepts a name that resolves only to public addresses (IPv4 and IPv6)', async () => {
    mockDns(answer('93.184.216.34'), answer('93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946'));
    await expect(assertSafeUrl('https://hooks.customer.example/h', strict)).resolves.toBeInstanceOf(URL);
    await expect(assertSafeUrl('https://hooks.customer.example/h', strict)).resolves.toBeInstanceOf(URL);
  });

  it('refuses a public-looking name that resolves to a private, loopback, metadata or mapped address', async () => {
    for (const bad of ['10.0.0.8', '127.0.0.1', '169.254.169.254', '::1', 'fd00::5', '::ffff:10.0.0.8', '::ffff:7f00:1', '2002:7f00:1::', '0:0:0:0:0:0:0:1', '100.64.0.9']) {
      mockDns(answer(bad));
      await expect(assertSafeUrl('https://looks-public.example/hook', strict)).rejects.toMatchObject({ code: 'UNSAFE_HOST' });
    }
  });

  it('refuses a name whose answers MIX public and prohibited addresses, in either order', async () => {
    mockDns(answer('93.184.216.34', '10.0.0.1'), answer('10.0.0.1', '93.184.216.34'), answer('2606:4700:4700::1111', '169.254.169.254'), answer('8.8.8.8', 'fe80::1'));
    for (let i = 0; i < 4; i++) await expect(assertSafeUrl('https://mixed.example/hook', strict)).rejects.toMatchObject({ code: 'UNSAFE_HOST' });
  });

  it('fails closed when resolution fails or returns nothing', async () => {
    mockDns(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }), Object.assign(new Error('timeout'), { code: 'ETIMEOUT' }), []);
    await expect(assertSafeUrl('https://nx.example/', strict)).rejects.toMatchObject({ code: 'DNS_FAILED' });
    await expect(assertSafeUrl('https://slow.example/', strict)).rejects.toMatchObject({ code: 'DNS_FAILED' });
    await expect(assertSafeUrl('https://empty.example/', strict)).rejects.toMatchObject({ code: 'UNSAFE_HOST' });
  });

  describe('DNS rebinding: the connection uses the address that was checked, and the check is repeated at connect time', () => {
    /** Runs safeRequest with the socket layer replaced, and hands back the options the request would have connected with. */
    const captureConnectOptions = async (raw: string) => {
      let captured: any;
      (https.request as unknown as jest.Mock).mockImplementationOnce(((opts: any) => {
        captured = opts;
        const req: any = new EventEmitter();
        req.write = () => true;
        req.end = () => setImmediate(() => req.emit('error', new Error('stubbed: no network in tests')));
        req.destroy = () => undefined;
        return req;
      }) as any);
      await safeRequest(raw, { env: strict, timeoutMs: 1000 }).catch(() => undefined);
      return captured;
    };

    it('connects through its own lookup (no second system lookup), without a shared agent, and keeps the host name for TLS', async () => {
      const opts = await captureConnectOptions('https://hooks.customer.example/path?x=1');
      expect(typeof opts.lookup).toBe('function');
      expect(opts.agent).toBe(false);
      expect(opts.hostname).toBe('hooks.customer.example');
      expect(opts.path).toBe('/path?x=1');
      expect(opts.followRedirects).toBeUndefined();
      expect(opts.maxRedirects).toBeUndefined();
    });

    const callLookup = (lookup: any, host: string, options: any = {}) =>
      new Promise<{ err: any; address: any; family?: number }>((resolve) => lookup(host, options, (err: any, address: any, family?: number) => resolve({ err, address, family })));

    it('hands the connection exactly one validated address, in both the single and the "all" calling forms', async () => {
      const opts = await captureConnectOptions('https://hooks.customer.example/');
      mockDns(answer('93.184.216.34'), answer('93.184.216.34'));
      expect(await callLookup(opts.lookup, 'hooks.customer.example')).toMatchObject({ err: null, address: '93.184.216.34', family: 4 });
      const all = await callLookup(opts.lookup, 'hooks.customer.example', { all: true });
      expect(all.err).toBeNull();
      expect(all.address).toEqual([{ address: '93.184.216.34', family: 4 }]);
    });

    it('rebinding: a name that looked public when the URL was accepted but now answers with a private address is refused at connect time', async () => {
      // first lookup = the check when the integration was saved; second = the lookup made for the actual connection
      mockDns(answer('93.184.216.34'), answer('169.254.169.254'));
      await expect(assertSafeUrl('https://rebind.example/hook', strict)).resolves.toBeInstanceOf(URL);
      const opts = await captureConnectOptions('https://rebind.example/hook');
      const second = await callLookup(opts.lookup, 'rebind.example');
      expect(second.err).toBeInstanceOf(UnsafeUrlError);
      expect(second.address).toBeUndefined();
    });

    it('a mixed answer at connect time is refused rather than "the public one" being picked', async () => {
      const opts = await captureConnectOptions('https://mixed.example/');
      mockDns(answer('10.0.0.1', '93.184.216.34'));
      expect((await callLookup(opts.lookup, 'mixed.example')).err).toBeInstanceOf(UnsafeUrlError);
    });

    it('an IP literal host is checked directly, before any socket or lookup', async () => {
      const lookup = jest.spyOn(dns.promises, 'lookup');
      await expect(safeRequest('https://[::ffff:7f00:1]/', { env: strict })).rejects.toBeInstanceOf(UnsafeUrlError);
      await expect(safeRequest('https://0x7f.1/', { env: strict })).rejects.toBeInstanceOf(UnsafeUrlError);
      await expect(safeRequest('https://example.com:22/', { env: strict })).rejects.toMatchObject({ code: 'UNSAFE_PORT' });
      expect(lookup).not.toHaveBeenCalled();
    });
  });
});

describe('response handling against a hostile server (loopback fixture, development flag)', () => {
  let server: http.Server;
  let base: string;
  const hits: string[] = [];
  const closedEarly: string[] = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      hits.push(req.url ?? '');
      if (req.url === '/loop') {
        res.writeHead(302, { location: `${base}/loop` }).end();
      } else if (req.url === '/to-metadata') {
        res.writeHead(307, { location: 'http://169.254.169.254/latest/meta-data/' }).end();
      } else if (req.url === '/to-private') {
        res.writeHead(301, { location: 'http://10.0.0.1/admin' }).end();
      } else if (req.url === '/endless') {
        res.writeHead(200, { 'content-type': 'application/octet-stream' });
        const chunk = Buffer.alloc(16 * 1024, 65);
        let sent = 0;
        const timer = setInterval(() => {
          if (res.destroyed || res.writableEnded) return clearInterval(timer);
          for (let i = 0; i < 8; i++) res.write(chunk);
          sent += 8 * chunk.length;
          if (sent > 200 * 1024 * 1024) clearInterval(timer);
        }, 1);
        res.on('close', () => {
          clearInterval(timer);
          closedEarly.push(req.url ?? '');
        });
      } else if (req.url === '/binary') {
        res.writeHead(200, { 'content-type': 'image/png' }).end(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 255, 254]));
      } else if (req.url === '/hang') {
        // never answers
      } else {
        res.writeHead(200).end('ok');
      }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    server.closeAllConnections?.();
    await new Promise<void>((r) => server.close(() => r()));
  });
  beforeEach(() => (hits.length = 0));

  it('never follows a redirect: a loop, a redirect to the metadata address and one to a private address each cost exactly one request', async () => {
    for (const path of ['/loop', '/to-metadata', '/to-private']) {
      const r = await safeRequest(`${base}${path}`, { env: dev, timeoutMs: 2000 });
      expect([301, 302, 307]).toContain(r.status);
    }
    expect(hits).toEqual(['/loop', '/to-metadata', '/to-private']); // the targets were never contacted
  });

  it('stops downloading at the cap: an endless response is cut off and the connection is closed, not drained', async () => {
    const started = Date.now();
    const r = await safeRequest(`${base}/endless`, { env: dev, maxBytes: 2048, timeoutMs: 5000 });
    expect(r.status).toBe(200);
    expect(r.body.length).toBe(2048);
    expect(Date.now() - started).toBeLessThan(2500);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(closedEarly).toContain('/endless'); // the server saw the client hang up
  });

  it('reads a small response completely and keeps the status', async () => {
    const r = await safeRequest(`${base}/anything`, { env: dev, maxBytes: 2048 });
    expect(r).toMatchObject({ status: 200, body: 'ok' });
  });

  it('a binary or unexpected content type is read as bounded text and never interpreted (the body is only a delivery log excerpt)', async () => {
    const r = await safeRequest(`${base}/binary`, { env: dev, maxBytes: 1024 });
    expect(r.status).toBe(200);
    expect(typeof r.body).toBe('string');
    expect(r.body.length).toBeLessThanOrEqual(1024);
  });

  it('a server that never answers is cut off at the timeout', async () => {
    const started = Date.now();
    await expect(safeRequest(`${base}/hang`, { env: dev, timeoutMs: 300 })).rejects.toThrow(/timeout/);
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it('refuses the same loopback server when the development flag is not set (production behaviour)', async () => {
    await expect(safeRequest(`${base}/anything`, { env: { NODE_ENV: 'production', INTEGRATIONS_ALLOW_PRIVATE_NETWORK: 'true' } as any })).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(safeRequest(`${base}/anything`, { env: strict })).rejects.toBeInstanceOf(UnsafeUrlError);
    expect(hits).toEqual([]); // not even a connection was made
  });
});
