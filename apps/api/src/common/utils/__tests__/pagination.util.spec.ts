import { boundedPage, boundedWindow, MAX_PAGE_LIMIT, MAX_PAGE_NUMBER } from '../pagination.util';

describe('boundedPage / boundedWindow', () => {
  it('passes legitimate values through unchanged', () => {
    expect(boundedPage(3, 25)).toEqual({ page: 3, limit: 25, offset: 50 });
    expect(boundedPage('2', '10')).toEqual({ page: 2, limit: 10, offset: 10 });
    expect(boundedPage(1, MAX_PAGE_LIMIT)).toEqual({ page: 1, limit: MAX_PAGE_LIMIT, offset: 0 });
    expect(boundedWindow(50, 100)).toEqual({ limit: 50, offset: 100 });
  });

  it('caps an excessive limit instead of returning the whole table', () => {
    expect(boundedPage(1, 1_000_000_000).limit).toBe(MAX_PAGE_LIMIT);
    expect(boundedPage(1, '99999999999999999999').limit).toBe(MAX_PAGE_LIMIT);
    expect(boundedPage(1, 500, { maxLimit: 200 }).limit).toBe(200);
    expect(boundedWindow(10_000, 0, { maxLimit: 200 }).limit).toBe(200);
  });

  it('turns garbage into the defaults, never NaN, a negative number or a thrown error', () => {
    for (const bad of [NaN, Infinity, -Infinity, -5, 0, '', 'abc', '1e999', null, undefined, {}, [], ['1'], true]) {
      const r = boundedPage(bad, bad);
      expect(r).toEqual({ page: 1, limit: 20, offset: 0 });
      const w = boundedWindow(bad, bad);
      expect(w).toEqual({ limit: 20, offset: 0 });
    }
  });

  it('floors fractions and bounds the page so the offset cannot overflow', () => {
    expect(boundedPage(2.9, 10.9)).toEqual({ page: 2, limit: 10, offset: 10 });
    const r = boundedPage(Number.MAX_SAFE_INTEGER, 100);
    expect(r.page).toBe(MAX_PAGE_NUMBER);
    expect(r.offset).toBeLessThan(2 ** 31);
    expect(boundedWindow(10, Number.MAX_SAFE_INTEGER).offset).toBeLessThan(2 ** 31);
  });

  it('respects a custom default', () => {
    expect(boundedPage(undefined, undefined, { defaultLimit: 50 }).limit).toBe(50);
    expect(boundedWindow(undefined, undefined, { defaultLimit: 100 })).toEqual({ limit: 100, offset: 0 });
  });
});
