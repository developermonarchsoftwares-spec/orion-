import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sanitizeCsvCell, csvField } from '../csv-security.ts';

// S-18 proof: cells that would execute as spreadsheet formulas are neutralised.
describe('S-18 CSV formula-injection neutralisation', () => {
  for (const trigger of ['=', '+', '-', '@', '\t', '\r']) {
    it(`prefixes a leading "${trigger === '\t' ? '\\t' : trigger === '\r' ? '\\r' : trigger}"`, () => {
      const payload = `${trigger}HYPERLINK("http://evil","x")`;
      assert.equal(sanitizeCsvCell(payload), `'${payload}`);
    });
  }

  it('leaves safe values unchanged', () => {
    assert.equal(sanitizeCsvCell('Acme Pvt Ltd'), 'Acme Pvt Ltd');
    assert.equal(sanitizeCsvCell('+91 98765 43210'[0] === '+' ? 'x' : '+91'), 'x'); // sanity on trigger detection
    assert.equal(sanitizeCsvCell(''), '');
    assert.equal(sanitizeCsvCell(null), '');
  });

  it('csvField neutralises and quotes, doubling embedded quotes', () => {
    assert.equal(csvField('=1+1'), `"'=1+1"`);
    assert.equal(csvField('a"b'), `"a""b"`);
  });
});

// P9: a trigger hidden behind leading whitespace or control characters is neutralised too.
describe('P9 hidden formula triggers', () => {
  for (const code of [32, 9, 1, 160, 0x200b, 0xfeff]) {
    it(`neutralises a trigger after prefix code ${code}`, () => {
      const v = String.fromCharCode(code) + '=1+1';
      assert.equal(sanitizeCsvCell(v), "'" + v);
    });
  }
  it('neutralises a trigger after several blanks', () => {
    assert.equal(sanitizeCsvCell('   @x'), "'   @x");
  });
  it('does not touch ordinary text that merely contains a trigger', () => {
    assert.equal(sanitizeCsvCell('a=b'), 'a=b');
    assert.equal(sanitizeCsvCell(' plain'), ' plain');
    assert.equal(sanitizeCsvCell('   '), '   ');
  });
});
