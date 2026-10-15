import { inflateRawSync } from 'zlib';
import { parseCsv } from '../csv-parse.util';
import { buildXlsx, columnName, crc32 } from '../xlsx-writer.util';
import { CsvSecurityUtil } from '../csv-security.util';

/** Independent zip reader (central directory), so the writer is not tested against its own assumptions. */
function readZip(buf: Buffer): Record<string, string> {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString('utf8');
    const lnlen = buf.readUInt16LE(lho + 26);
    const lelen = buf.readUInt16LE(lho + 28);
    const raw = buf.subarray(lho + 30 + lnlen + lelen, lho + 30 + lnlen + lelen + csize);
    const data = method === 8 ? inflateRawSync(raw) : raw;
    expect(data.length).toBe(usize);
    expect(crc32(data)).toBe(crc);
    out[name] = data.toString('utf8');
    p += 46 + nlen + elen + clen;
  }
  return out;
}

describe('parseCsv', () => {
  it('parses quoted fields, doubled quotes, embedded commas and line breaks, CRLF and a BOM', () => {
    const r = parseCsv('﻿name,address,note\r\n"Acme, Inc","12 Main St\nSuite 4","say ""hi"""\r\nBeta,Road,plain\r\n');
    expect(r.issues).toEqual([]);
    expect(r.headers).toEqual(['name', 'address', 'note']);
    expect(r.rows).toEqual([
      { name: 'Acme, Inc', address: '12 Main St\nSuite 4', note: 'say "hi"' },
      { name: 'Beta', address: 'Road', note: 'plain' },
    ]);
  });

  it('detects semicolon and tab delimiters', () => {
    expect(parseCsv('a;b\n1;2').rows).toEqual([{ a: '1', b: '2' }]);
    expect(parseCsv('a\tb\n1\t2').rows).toEqual([{ a: '1', b: '2' }]);
  });

  it('reports structure problems by row and code, never echoing content, and keeps usable rows', () => {
    const r = parseCsv('name,city,name,\nA,B,C,D\nonly\nX,Y,Z,W,EXTRA\n');
    const problems = r.issues.map((i) => `${i.row}:${i.problem}`);
    expect(problems).toEqual(expect.arrayContaining(['0:DUPLICATE_HEADER', '0:EMPTY_HEADER', '2:FEWER_CELLS_THAN_HEADERS', '3:MORE_CELLS_THAN_HEADERS']));
    expect(r.issues.every((i) => !i.fatal)).toBe(true);
    expect(JSON.stringify(r.issues)).not.toMatch(/EXTRA|only/);
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0]).toEqual({ name: 'A', city: 'B' }); // first of two same-named columns wins; unnamed column dropped
  });

  it('flags fatal problems: empty file, unterminated quote, too many rows or columns', () => {
    expect(parseCsv('   \n').issues).toEqual([{ row: 0, problem: 'EMPTY_FILE', fatal: true }]);
    expect(parseCsv('a,b\n"open,1').issues.some((i) => i.problem === 'UNTERMINATED_QUOTE' && i.fatal)).toBe(true);
    expect(parseCsv('a\n1\n2\n3', { maxRows: 2 }).issues.some((i) => i.problem === 'TOO_MANY_ROWS' && i.fatal)).toBe(true);
    expect(parseCsv('a,b,c\n1,2,3', { maxColumns: 2 }).issues.some((i) => i.problem === 'TOO_MANY_COLUMNS' && i.fatal)).toBe(true);
  });

  it('skips blank lines and does not let a header named like a prototype key pollute anything', () => {
    const r = parseCsv('name,__proto__\nA,evil\n\n,\nB,x');
    expect(r.rows).toHaveLength(2);
    expect(({} as any).evil).toBeUndefined();
    expect(Object.getPrototypeOf(r.rows[0])).toBe(Object.prototype);
  });

  it('round-trips what the CSV export writes', () => {
    const line = CsvSecurityUtil.formatCsvRow(['Acme, "Best" Inc', 'multi\nline', 'plain']);
    const r = parseCsv(`h1,h2,h3\n${line}\n`);
    expect(r.rows[0]).toEqual({ h1: 'Acme, "Best" Inc', h2: 'multi\nline', h3: 'plain' });
  });
});

describe('buildXlsx', () => {
  it('writes a valid package whose parts, checksums and sizes verify, with escaped text and no formulas', () => {
    const buf = buildXlsx(['Name', 'Note'], [['A & B <x>', '=SUM(1,2)'], ['नमस्ते', 'a\u0001b']], 'My: Sheet?');
    const files = readZip(buf);
    expect(Object.keys(files).sort()).toEqual(['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml']);
    const sheet = files['xl/worksheets/sheet1.xml'];
    expect(sheet).toContain('A &amp; B &lt;x&gt;');
    expect(sheet).toContain('नमस्ते');
    expect(sheet).toContain('=SUM(1,2)'); // present as text...
    expect(sheet).not.toMatch(/<f>/); // ...never as a formula
    expect(sheet).toContain('>ab<'); // control character removed
    expect(files['xl/workbook.xml']).toContain('name="My  Sheet "');
    for (const xml of Object.values(files)) expect(xml.startsWith('<?xml')).toBe(true);
  });

  it('names columns like a spreadsheet and rejects data beyond the format limits', () => {
    expect([0, 25, 26, 27, 51, 52, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA']);
    expect(() => buildXlsx(Array.from({ length: 16385 }, (_, i) => `c${i}`), [])).toThrow(/limit/);
  });
});
