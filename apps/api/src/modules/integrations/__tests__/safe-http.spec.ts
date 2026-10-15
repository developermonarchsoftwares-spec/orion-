import * as http from 'http';
import { AddressInfo } from 'net';
import { assertSafeUrl, isBlockedAddress, parseTargetUrl, privateNetworkAllowed, safeRequest, UnsafeUrlError } from '../net/safe-http';

const dev = { NODE_ENV: 'test', INTEGRATIONS_ALLOW_PRIVATE_NETWORK: 'true' } as unknown as NodeJS.ProcessEnv;
const prod = { NODE_ENV: 'production', INTEGRATIONS_ALLOW_PRIVATE_NETWORK: 'true' } as unknown as NodeJS.ProcessEnv;
const strict = { NODE_ENV: 'test' } as unknown as NodeJS.ProcessEnv;

describe('isBlockedAddress', () => {
  it.each([
    '0.0.0.0', '10.1.2.3', '127.0.0.1', '127.255.255.254', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.168.1.1', '100.64.0.1', '100.127.255.255',
    '198.18.0.1', '224.0.0.1', '255.255.255.255', '192.0.2.5', '203.0.113.9',
    '::', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1', '2001:db8::1',
    '::ffff:127.0.0.1', '::ffff:169.254.169.254', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '64:ff9b::10.0.0.1', '[::1]', 'fe80::1%eth0',
    'not-an-ip', '',
  ])('blocks %s', (ip) => expect(isBlockedAddress(ip)).toBe(true));

  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.0.1', '172.32.0.1', '100.63.255.255', '100.128.0.1', '2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8'])('allows %s', (ip) => expect(isBlockedAddress(ip)).toBe(false));
});

describe('parseTargetUrl / assertSafeUrl', () => {
  it('requires https, refuses credentials, odd schemes and over-long URLs', () => {
    expect(() => parseTargetUrl('http://example.com/hook', strict)).toThrow(/https/);
    expect(() => parseTargetUrl('ftp://example.com', strict)).toThrow(UnsafeUrlError);
    expect(() => parseTargetUrl('file:///etc/passwd', strict)).toThrow(UnsafeUrlError);
    expect(() => parseTargetUrl('javascript:alert(1)', strict)).toThrow(UnsafeUrlError);
    expect(() => parseTargetUrl('https://user:pw@example.com/', strict)).toThrow(/credentials/);
    expect(() => parseTargetUrl('https://example.com/' + 'a'.repeat(600), strict)).toThrow(/too long/);
    expect(() => parseTargetUrl('', strict)).toThrow(UnsafeUrlError);
    expect(() => parseTargetUrl('not a url', strict)).toThrow(UnsafeUrlError);
    expect(parseTargetUrl('https://example.com/hook?a=1', strict).hostname).toBe('example.com');
  });

  it('refuses IP-literal targets in every notation without any DNS lookup', async () => {
    for (const url of ['https://127.0.0.1/', 'https://10.0.0.5:8443/x', 'https://169.254.169.254/latest/meta-data', 'https://[::1]/', 'https://[fd00::1]/', 'https://[::ffff:127.0.0.1]/', 'https://2130706433/', 'https://0x7f.1/', 'https://127.1/', 'https://0/']) {
      await expect(assertSafeUrl(url, strict)).rejects.toMatchObject({ code: 'UNSAFE_HOST' });
    }
    await expect(assertSafeUrl('https://8.8.8.8/hook', strict)).resolves.toBeInstanceOf(URL);
  });

  it('refuses a host name that resolves to localhost, and one that does not resolve', async () => {
    await expect(assertSafeUrl('https://localhost/hook', strict)).rejects.toMatchObject({ code: 'UNSAFE_HOST' });
    await expect(assertSafeUrl('https://this-host-does-not-exist.invalid/', strict)).rejects.toMatchObject({ code: 'DNS_FAILED' });
  });

  it('the private-network flag works outside production and is ignored in production', async () => {
    expect(privateNetworkAllowed(dev)).toBe(true);
    expect(privateNetworkAllowed(prod)).toBe(false);
    expect(privateNetworkAllowed(strict)).toBe(false);
    await expect(assertSafeUrl('http://127.0.0.1:9/hook', dev)).resolves.toBeInstanceOf(URL);
    await expect(assertSafeUrl('http://127.0.0.1:9/hook', prod)).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(assertSafeUrl('https://127.0.0.1/', prod)).rejects.toMatchObject({ code: 'UNSAFE_HOST' });
  });
});

describe('safeRequest', () => {
  let server: http.Server;
  let base: string;
  const seen: Array<{ method?: string; url?: string; headers: http.IncomingHttpHeaders; body: string }> = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        seen.push({ method: req.method, url: req.url, headers: req.headers, body });
        if (req.url === '/redirect') {
          res.writeHead(302, { location: 'http://127.0.0.1:1/internal' }).end();
        } else if (req.url === '/slow') {
          setTimeout(() => res.end('late'), 2000);
        } else if (req.url === '/big') {
          res.end('x'.repeat(500_000));
        } else res.writeHead(201).end('ok');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('sends method, headers and body, and returns status and text', async () => {
    const r = await safeRequest(`${base}/hook?x=1`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-test': 'yes' }, body: '{"a":1}', env: dev });
    expect(r).toMatchObject({ status: 201, body: 'ok' });
    const last = seen.at(-1)!;
    expect(last).toMatchObject({ method: 'POST', url: '/hook?x=1', body: '{"a":1}' });
    expect(last.headers['x-test']).toBe('yes');
    expect(last.headers['content-length']).toBe('7');
  });

  it('refuses a private target when the flag is off, without connecting', async () => {
    const before = seen.length;
    await expect(safeRequest(`${base}/hook`, { env: strict })).rejects.toBeInstanceOf(UnsafeUrlError); // http not allowed
    await expect(safeRequest(`https://127.0.0.1:${new URL(base).port}/hook`, { env: strict })).rejects.toBeInstanceOf(UnsafeUrlError);
    expect(seen.length).toBe(before);
  });

  it('does not follow redirects: the 3xx is returned as is and the redirect target is never contacted', async () => {
    const r = await safeRequest(`${base}/redirect`, { env: dev });
    expect(r.status).toBe(302);
    expect(seen.some((s) => s.url === '/internal')).toBe(false);
  });

  it('times out, and stops reading a large response', async () => {
    await expect(safeRequest(`${base}/slow`, { env: dev, timeoutMs: 200 })).rejects.toThrow(/timeout/);
    const big = await safeRequest(`${base}/big`, { env: dev, maxBytes: 1000 });
    expect(big.body.length).toBe(1000);
  });
});
