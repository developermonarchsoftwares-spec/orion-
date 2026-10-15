import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { safeHttpHref } from '../safe-url.ts';

describe('safeHttpHref: stored URLs that are rendered as links', () => {
  it('returns http and https addresses, and treats a bare address as https', () => {
    assert.equal(safeHttpHref('https://www.acme.in/about'), 'https://www.acme.in/about');
    assert.equal(safeHttpHref('http://acme.in'), 'http://acme.in/');
    assert.equal(safeHttpHref('  acme.in/products '), 'https://acme.in/products');
    assert.equal(safeHttpHref('HTTPS://ACME.IN/X'), 'https://acme.in/X');
  });

  it('never returns a script-capable or non-web link', () => {
    for (const bad of [
      'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'javascript://acme.in/%0Aalert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:x',
      'file:///etc/passwd', 'ftp://acme.in', 'mailto:a@b.co', 'blob:https://acme.in/x', ' javascript:alert(1)', '\tjavascript:alert(1)',
    ]) {
      assert.equal(safeHttpHref(bad), undefined, bad);
    }
  });

  it('refuses credentials, control characters, empty, over-long and non-string values', () => {
    assert.equal(safeHttpHref('https://user:pw@acme.in'), undefined);
    assert.equal(safeHttpHref('https://acme.in/\u0000'), undefined);
    assert.equal(safeHttpHref('https://acme.in/\nx'), undefined); // an embedded line break is refused
    assert.equal(safeHttpHref('https://acme.in/\n'), 'https://acme.in/'); // trailing whitespace is simply trimmed
    assert.equal(safeHttpHref(''), undefined);
    assert.equal(safeHttpHref('   '), undefined);
    assert.equal(safeHttpHref(`https://acme.in/${'a'.repeat(3000)}`), undefined);
    for (const v of [null, undefined, 5, {}, [], true]) assert.equal(safeHttpHref(v), undefined);
  });
});
