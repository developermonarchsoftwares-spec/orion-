import { CsvSecurityUtil } from '../csv-security.util';
import { applyDownloadHeaders, safeDownloadName } from '../../http/download-headers';

describe('CSV formula safety (Phase 9)', () => {
  it.each([
    ['=1+1', "'=1+1"],
    ['+cmd|x', "'+cmd|x"],
    ['-2+3', "'-2+3"],
    ['@SUM(A1)', "'@SUM(A1)"],
    [' =1+1', "' =1+1"], // leading space
    ['   =1+1', "'   =1+1"],
    ['\t=1+1', "'\t=1+1"],
    ['\r=1+1', "'\r=1+1"],
    ['\n=1+1', "'\n=1+1"],
    ['\u0000=1+1', "'\u0000=1+1"], // control character
    ['\u00a0=1+1', "'\u00a0=1+1"], // no-break space
    ['\ufeff=1+1', "'\ufeff=1+1"],
    ['\u200b@x', "'\u200b@x"], // zero-width space
  ])('neutralises %j', (input, expected) => {
    expect(CsvSecurityUtil.sanitizeCell(input)).toBe(expected);
  });

  it.each(['Acme Ltd', 'a=b', 'x-ray', 'mail@x.com', '100', '', ' plain text', 'He said "hi"'])('leaves %j alone', (v) => {
    expect(CsvSecurityUtil.sanitizeCell(v)).toBe(v);
  });

  it('keeps plain phone numbers intact in phone columns and still guards everything else there', () => {
    for (const p of ['+91 98765 43210', '+919876543210', '+1 (415) 555-0100', '080-2345 6789', '9876543210', '+44.20.7946.0958']) {
      expect(CsvSecurityUtil.sanitizePhoneCell(p)).toBe(p);
    }
    for (const p of ['+cmd|x', '+91=1+1', '=1+1', '+91 98765 @A1', ' +1+1', '-1+1', '+', '@x']) {
      expect(CsvSecurityUtil.sanitizePhoneCell(p).startsWith("'")).toBe(true);
    }
    // a non-phone column is still prefixed, whatever it looks like
    expect(CsvSecurityUtil.formatCsvRow(['+91 98765 43210'])).toBe(`"'+91 98765 43210"`);
    expect(CsvSecurityUtil.formatCsvRow(['x', '+91 98765 43210'], [1])).toBe(`"x","+91 98765 43210"`);
  });

  it('escapes quotes, commas and newlines so a cell cannot add a column or a row', () => {
    const line = CsvSecurityUtil.formatCsvRow(['a,b', 'say "x"', 'l1\nl2', 'tail\r\n=1+1']);
    expect(line).toBe(`"a,b","say ""x""","l1\nl2","tail\r\n=1+1"`);
  });
});

describe('download headers (Phase 9)', () => {
  const fakeRes = () => {
    const h: Record<string, string> = {};
    return { h, setHeader: (k: string, v: string) => void (h[k] = v) } as any;
  };

  it('always a no-store attachment with nosniff', () => {
    const res = fakeRes();
    applyDownloadHeaders(res, 'text/csv; charset=utf-8', 'orion-saved-leads-2026-10-10.csv');
    expect(res.h['Content-Disposition']).toBe('attachment; filename="orion-saved-leads-2026-10-10.csv"');
    expect(res.h['Cache-Control']).toMatch(/no-store/);
    expect(res.h['Cache-Control']).toMatch(/private/);
    expect(res.h['X-Content-Type-Options']).toBe('nosniff');
    expect(res.h['Content-Type']).toBe('text/csv; charset=utf-8');
  });

  it('a file name cannot carry a path, a quote or a header break', () => {
    for (const bad of ['../../etc/passwd', 'a"b.csv', 'a\r\nSet-Cookie: x=1', `C:${String.fromCharCode(92)}Windows${String.fromCharCode(92)}x.csv`, '/abs/path.csv', '..hidden', 'näme é.csv']) {
      const n = safeDownloadName(bad);
      expect(n).toMatch(/^[A-Za-z0-9._-]+$/);
      expect(n.startsWith('.')).toBe(false);
      expect(n).not.toMatch(/[\/"\r\n]/);
    }
    expect(safeDownloadName('')).toBe('download');
    expect(safeDownloadName(null)).toBe('download');
    expect(safeDownloadName('x'.repeat(500)).length).toBeLessThanOrEqual(120);
  });
});
