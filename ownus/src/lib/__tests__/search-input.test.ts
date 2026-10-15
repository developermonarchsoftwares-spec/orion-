import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  MAX_EXPORT_IDS,
  MAX_FILTER_TEXT,
  MAX_LIST_ITEMS,
  MAX_LIST_ITEM_LENGTH,
  MAX_PAGE,
  MAX_QUERY_LENGTH,
  clampText,
  escapeLike,
  parseLimit,
  parsePage,
  splitList,
} from '../search-input.ts';

describe('gateway search and export input limits', () => {
  it('clampText trims, strips control characters (NUL included) and bounds the length', () => {
    assert.equal(clampText('  Pune  ', MAX_FILTER_TEXT), 'Pune');
    assert.equal(clampText('a\u0000b\u0007c\u001fd', 50), 'abcd');
    assert.equal(clampText('x'.repeat(5000), MAX_QUERY_LENGTH).length, MAX_QUERY_LENGTH);
    assert.equal(clampText(null, 10), '');
    assert.equal(clampText(undefined, 10), '');
    assert.equal(clampText('tab\tinside', 50), 'tab\tinside'); // ordinary whitespace survives
    assert.equal(clampText('नमस्ते 日本語', 50), 'नमस्ते 日本語');
  });

  it('parsePage and parseLimit never produce NaN, zero, negatives or unbounded numbers', () => {
    for (const bad of ['abc', '', '-3', '0', 'NaN', 'Infinity', null, undefined, '  ']) {
      assert.equal(parsePage(bad as any), 1, `page ${String(bad)}`);
      assert.equal(parseLimit(bad as any), 25, `limit ${String(bad)}`);
    }
    assert.equal(parsePage('3'), 3);
    assert.equal(parsePage('2.9'), 2);
    assert.equal(parsePage('99999999999999999999'), MAX_PAGE);
    assert.equal(parseLimit('50'), 50);
    assert.equal(parseLimit('100'), 100);
    assert.equal(parseLimit('1000000000'), 100);
    assert.equal(parseLimit('abc', 10, 20), 10);
    assert.equal(parseLimit('500', 10, 20), 20);
  });

  it('escapeLike makes %, _ and backslash literal', () => {
    assert.equal(escapeLike('100%'), '100\\%');
    assert.equal(escapeLike('a_b'), 'a\\_b');
    assert.equal(escapeLike('c:\\x'), 'c:\\\\x');
    assert.equal(escapeLike('plain text'), 'plain text');
    assert.equal(escapeLike('%'), '\\%'); // a lone % no longer matches every row
  });

  it('splitList bounds the number and size of items and drops empties', () => {
    assert.deepEqual(splitList('a, b ,,c'), ['a', 'b', 'c']);
    assert.deepEqual(splitList(null), []);
    assert.deepEqual(splitList(''), []);
    assert.equal(splitList(Array.from({ length: 5000 }, (_, i) => `v${i}`).join(',')).length, MAX_LIST_ITEMS);
    assert.equal(splitList(`${'x'.repeat(1000)},ok`)[0].length, MAX_LIST_ITEM_LENGTH);
    assert.deepEqual(splitList('a\u0000b,c'), ['ab', 'c']);
    assert.equal(splitList(Array.from({ length: 5000 }, () => '00000000-0000-4000-8000-000000000000').join(','), MAX_EXPORT_IDS, 64).length, MAX_EXPORT_IDS);
  });

  it('the native search and export handlers use these helpers (no raw parseInt, wildcard-active patterns or unbounded lists)', () => {
    const src = fs.readFileSync(path.resolve(import.meta.dirname, '../../app/api/v1/[...path]/route.ts'), 'utf8');
    const start = src.indexOf('async function handleDiscoverSearch');
    const end = src.indexOf('async function handleDiscoverExport');
    const exportEnd = src.indexOf('Discover Export Unlocked Leads API Handler');
    assert.ok(start > 0 && end > start && exportEnd > end);
    const search = src.slice(start, end);
    const exp = src.slice(end, exportEnd);
    assert.doesNotMatch(search, /parseInt\(searchParams\.get\('(page|limit)'\)/);
    assert.doesNotMatch(search, /queryValues\.push\(`%\$\{(q|state|pincode)\b/); // always through escapeLike
    assert.doesNotMatch(search, /\.split\(','\)\.map\(\(s\) => s\.trim\(\)\)\.filter\(Boolean\)/);
    assert.match(search, /clampText\(searchParams\.get\('q'\), MAX_QUERY_LENGTH\)/);
    assert.match(exp, /LIMIT \$\{MAX_EXPORT_ROWS \+ 1\}/);
    assert.match(exp, /splitList\(queryIds, MAX_EXPORT_IDS/);
    assert.match(exp, /X-Export-Truncated/);
  });
});
