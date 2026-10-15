import { MAX_STORED_URL_LENGTH, parseLinkedinPageUrl, parsePublicUrl } from '../public-url.util';

describe('parsePublicUrl: untrusted URLs that will be stored and shown as links', () => {
  it('accepts ordinary public websites and keeps the shape people typed', () => {
    expect(parsePublicUrl('https://www.tcs.com')).toEqual({ ok: true, url: 'https://www.tcs.com', host: 'www.tcs.com' });
    expect(parsePublicUrl('http://acme.example.org/about?x=1#team')).toMatchObject({ ok: true, url: 'http://acme.example.org/about?x=1#team' });
    expect(parsePublicUrl('  example.com  ')).toMatchObject({ ok: true, url: 'https://example.com' }); // bare address -> https
    expect(parsePublicUrl('www.infosys.com/investors')).toMatchObject({ ok: true, url: 'https://www.infosys.com/investors' });
    expect(parsePublicUrl('//cdn.acme.in/page')).toMatchObject({ ok: true, url: 'https://cdn.acme.in/page' });
    expect(parsePublicUrl('HTTPS://ACME.IN')).toMatchObject({ ok: true, host: 'acme.in' });
    expect(parsePublicUrl('https://bücher.example')).toMatchObject({ ok: true, host: 'xn--bcher-kva.example' });
    expect(parsePublicUrl('https://8.8.8.8/')).toMatchObject({ ok: true }); // a public address literal is not a safety problem here
  });

  it.each([
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'javascript://%0Aalert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)',
    'file:///etc/passwd', 'ftp://example.com/', 'gopher://example.com/', 'mailto:a@b.co', 'tel:+911234567890', 'blob:https://example.com/x', 'ws://example.com/',
  ])('refuses the scheme in %s', (value) => {
    const r = parsePublicUrl(value);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(['SCHEME', 'INVALID', 'CREDENTIALS']).toContain(r.reason);
  });

  it('refuses credentials embedded in the URL', () => {
    for (const v of ['https://user:pass@example.com', 'https://admin@example.com/x', 'http://:secret@example.com', 'https://example.com@evil.example']) {
      expect(parsePublicUrl(v)).toEqual({ ok: false, reason: 'CREDENTIALS' });
    }
  });

  it('refuses hosts that are not public: loopback, private, link-local, metadata, internal names, single-label names', () => {
    for (const v of [
      'http://localhost', 'https://localhost:3000/x', 'http://127.0.0.1', 'https://10.0.0.5/a', 'https://192.168.0.1', 'https://172.16.5.4', 'http://169.254.169.254/latest/meta-data',
      'https://[::1]/', 'https://[fd00::1]/', 'https://[::ffff:127.0.0.1]/', 'https://[2002:7f00:1::]/', 'https://[0:0:0:0:0:0:0:1]/', 'https://2130706433', 'https://0x7f.1', 'https://017700000001',
      'https://intranet', 'https://printer', 'https://db.internal', 'https://app.local', 'https://host.localdomain', 'https://x.corp', 'https://a.localhost', 'https://localhost.',
    ]) {
      const r = parsePublicUrl(v);
      expect({ v, ok: r.ok, reason: r.ok ? undefined : r.reason }).toEqual({ v, ok: false, reason: 'HOST_NOT_PUBLIC' });
    }
  });

  it('refuses control characters, whitespace inside the URL, NUL, over-long values and non-strings', () => {
    for (const v of ['https://exa mple.com', 'https://example.com/a b', 'https://example.com/\u0000', 'https://example.com/\nx', 'https://example.com/\u0007', "https://example.com/'><script>"]) {
      const r = parsePublicUrl(v);
      // a quote or angle bracket inside a path is legal URL text (it is encoded on output); whitespace and control characters are not
      if (/[\s\u0000-\u001f]/.test(v)) expect(r.ok).toBe(false);
    }
    expect(parsePublicUrl(`https://example.com/${'a'.repeat(MAX_STORED_URL_LENGTH)}`)).toEqual({ ok: false, reason: 'TOO_LONG' });
    for (const v of [null, undefined, 42, {}, [], true]) expect(parsePublicUrl(v as any)).toEqual({ ok: false, reason: 'INVALID' });
    expect(parsePublicUrl('')).toEqual({ ok: false, reason: 'EMPTY' });
    expect(parsePublicUrl('   ')).toEqual({ ok: false, reason: 'EMPTY' });
  });

  it('a stored result never contains a scheme other than http or https', () => {
    for (const v of ['example.com', 'http://example.com', 'https://example.com/x', '//example.com', 'www.example.com:8080/p']) {
      const r = parsePublicUrl(v);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.url).toMatch(/^https?:\/\//);
    }
  });
});

describe('parseLinkedinPageUrl', () => {
  it('accepts LinkedIn addresses only', () => {
    expect(parseLinkedinPageUrl('https://www.linkedin.com/company/tcs')).toMatchObject({ ok: true });
    expect(parseLinkedinPageUrl('linkedin.com/in/someone')).toMatchObject({ ok: true, url: 'https://linkedin.com/in/someone' });
    expect(parseLinkedinPageUrl('https://in.linkedin.com/company/x')).toMatchObject({ ok: true });
    expect(parseLinkedinPageUrl('https://lnkd.in/abc')).toMatchObject({ ok: true });
  });
  it('refuses look-alikes, other sites and unsafe values', () => {
    for (const v of ['https://evil.example/linkedin.com', 'https://linkedin.com.evil.example/x', 'https://notlinkedin.com/x', 'https://linkedin.example/x']) {
      expect(parseLinkedinPageUrl(v)).toEqual({ ok: false, reason: 'NOT_LINKEDIN' });
    }
    expect(parseLinkedinPageUrl('javascript:alert(1)').ok).toBe(false);
    expect(parseLinkedinPageUrl('company/tcs').ok).toBe(false);
    expect(parseLinkedinPageUrl('https://user:pw@linkedin.com/in/x')).toEqual({ ok: false, reason: 'CREDENTIALS' });
  });
});
