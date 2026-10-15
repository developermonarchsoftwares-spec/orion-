import { BadRequestException } from '@nestjs/common';
import { findInputProblem, InputGuardMiddleware, urlHasNul } from '../input-guard.middleware';

describe('input guard', () => {
  it('accepts ordinary input, including punctuation, unicode and SQL-looking text (that is the database layer\'s job)', () => {
    expect(findInputProblem({ q: "O'Brien & Sons; DROP TABLE users;--", city: 'Bengaluru', note: 'नमस्ते 日本語 🚀', n: 1, ok: true, list: [1, 'a', { b: null }] })).toBeNull();
    expect(findInputProblem(null)).toBeNull();
    expect(findInputProblem('plain string')).toBeNull();
    expect(findInputProblem({ constructor: 'a normal column called constructor' })).toBeNull();
  });

  it('rejects a NUL character in a value, a key, a nested value or an array', () => {
    expect(findInputProblem({ q: 'a\u0000b' })).toBe('NUL_BYTE');
    expect(findInputProblem({ 'k\u0000ey': 1 })).toBe('NUL_BYTE');
    expect(findInputProblem({ a: { b: [{ c: 'x\u0000' }] } })).toBe('NUL_BYTE');
    expect(findInputProblem(['\u0000'])).toBe('NUL_BYTE');
  });

  it('rejects prototype-pollution keys at any depth (from real JSON, where __proto__ is an own key)', () => {
    expect(findInputProblem(JSON.parse('{"__proto__": {"admin": true}}'))).toBe('PROTOTYPE_KEY');
    expect(findInputProblem(JSON.parse('{"a": {"b": [{"__proto__": {"x": 1}}]}}'))).toBe('PROTOTYPE_KEY');
    expect(findInputProblem(JSON.parse('{"constructor": {"prototype": {"admin": true}}}'))).toBe('PROTOTYPE_KEY');
  });

  it('rejects absurd nesting and size without blowing the stack', () => {
    let deep: any = 'x';
    for (let i = 0; i < 5000; i++) deep = { a: deep };
    expect(findInputProblem(deep)).toBe('TOO_DEEP');
    expect(findInputProblem(new Array(2_100_000).fill(0))).toBe('TOO_LARGE');
  });

  it('allows the largest legitimate import payload (5,000 rows of 40 columns)', () => {
    const row = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`col_${i}`, `value ${i}`]));
    expect(findInputProblem({ rows: Array.from({ length: 5000 }, () => ({ ...row })) })).toBeNull();
  });

  it('flags NUL in the request target, raw or percent-encoded', () => {
    expect(urlHasNul('/api/v1/discover/search?q=a%00b')).toBe(true);
    expect(urlHasNul('/api/v1/discover/search?q=a%00')).toBe(true);
    expect(urlHasNul('/api/v1/x\u0000y')).toBe(true);
    expect(urlHasNul('/api/v1/discover/search?q=100%25')).toBe(false);
    expect(urlHasNul('/api/v1/discover/search?q=a%0Ab')).toBe(false);
  });

  describe('as middleware', () => {
    const run = (req: any) => {
      let result: unknown = 'not called';
      new InputGuardMiddleware().use({ originalUrl: '/api/v1/x', ...req } as any, {} as any, ((e?: unknown) => (result = e)) as any);
      return result;
    };
    it('passes clean requests on with no error', () => {
      expect(run({ query: { q: 'abc' }, body: { a: 1 }, params: {} })).toBeUndefined();
    });
    it('answers unsafe requests with a 400 and a generic message that does not echo the input', () => {
      for (const req of [{ originalUrl: '/api/v1/x?q=%00', query: {}, body: {} }, { query: { q: 'a\u0000' }, body: {} }, { query: {}, body: JSON.parse('{"__proto__":{"a":1}}') }]) {
        const err = run(req) as BadRequestException;
        expect(err).toBeInstanceOf(BadRequestException);
        expect(err.getStatus()).toBe(400);
        expect(JSON.stringify(err.getResponse())).not.toContain('__proto__');
      }
    });
  });
});
