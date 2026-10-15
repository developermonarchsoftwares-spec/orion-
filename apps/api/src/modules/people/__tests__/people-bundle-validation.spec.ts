import { randomUUID } from 'crypto';
import { deflateRawSync } from 'zlib';
import { BusinessException } from '../../../common/errors/business.exception';
import { BUNDLE_LIMITS } from '../ingestion/bundle/people-bundle.manifest';
import { PeopleBundleImportService } from '../ingestion/bundle/people-bundle-import.service';
import { readZip } from '../ingestion/bundle/safe-zip';
import { PeopleExportImportService } from '../ingestion/people-export-import.service';
import { buildZip, exportRow, ExportRowInput, IBundleFx, makeBundle, packBundle, toBase64 } from './people-bundle-fixtures';

/**
 * Phase 9D: everything that decides, BEFORE anything is queued, whether a Pipeline bundle is accepted: the ZIP reader's defences and
 * the manifest / member / part checks. Pure (no database): a rejected bundle must have no side effect, so nothing here may need one.
 */
const svc = new PeopleBundleImportService(new PeopleExportImportService({} as any), {} as any);
const row = (i: number): ExportRowInput =>
  exportRow({ company_name: 'Alpha Works Pvt Ltd', company_city: 'Pune', company_state: 'Maharashtra', full_name: `Person Number${i}`, relationship_id: randomUUID() });
const rows = (n: number) => Array.from({ length: n }, (_, i) => row(i));
const validate = (zip: Buffer) => svc.validate(toBase64(zip));
const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    if (e instanceof BusinessException) return e.errorCode;
    throw e;
  }
  throw new Error('expected a refusal, but the bundle was accepted');
};
const details = (fn: () => unknown): any => {
  try {
    fn();
  } catch (e) {
    return (e as BusinessException).details;
  }
  return undefined;
};
const status = (fn: () => unknown): number => {
  try {
    fn();
  } catch (e) {
    return (e as BusinessException).getStatus();
  }
  return 200;
};
const sha = (s: string) => s;

describe('Pipeline bundle validation (Phase 9D)', () => {
  describe('valid bundles', () => {
    it.each(['csv', 'json'] as const)('accepts a valid %s bundle and reports its metadata only', (format) => {
      const b = makeBundle(rows(5), { format, partSize: 5 });
      const v = validate(packBundle(b));
      const s = svc.summary(v);
      expect(s).toMatchObject({ valid: true, bundleId: b.manifest.bundle_id, format, partCount: 1, totalRows: 5, maxPartRows: 5 });
      expect(s.parts).toEqual([{ partNumber: 1, filename: b.members[0].name, rowCount: 5, bytes: b.members[0].data.length }]);
      expect(JSON.stringify(s)).not.toMatch(/Person|Alpha|relationship|sha256/i);
      expect(v.parts[0].content.length).toBeGreaterThan(0);
    });

    it('accepts several parts in manifest order', () => {
      const b = makeBundle(rows(7), { partSize: 3 });
      const v = validate(packBundle(b));
      expect(v.parts.map((p) => [p.partNumber, p.rowCount])).toEqual([[1, 3], [2, 3], [3, 1]]);
      expect(v.manifest).toMatchObject({ part_count: 3, total_rows: 7, max_part_rows: 3 });
    });

    it('accepts a person with several companies and rows without optional contact fields', () => {
      const li = 'https://www.linkedin.com/in/multi-company-person';
      const r = [
        row(1), // no email / phone / mobile / linkedin at all
        { ...row(2), linkedin_url: li, email: 'multi@alpha-works.example' },
        { ...row(2), relationship_id: randomUUID(), linkedin_url: li, company_name: 'Bravo Mills Pvt Ltd', company_city: 'Chennai', company_state: 'Tamil Nadu' },
      ];
      expect(svc.summary(validate(packBundle(makeBundle(r, { partSize: 2 }))))).toMatchObject({ partCount: 2, totalRows: 3 });
    });
  });

  describe('manifest', () => {
    const tamper = (fn: (b: IBundleFx) => void, rowsN = 6, partSize = 3) => {
      const b = makeBundle(rows(rowsN), { partSize });
      fn(b);
      return packBundle(b);
    };
    it('missing manifest', () => {
      const b = makeBundle(rows(3));
      const zip = buildZip(b.members.map((m) => ({ name: m.name, data: m.data })));
      expect(code(() => validate(zip))).toBe('BUNDLE_MANIFEST_MISSING');
      expect(code(() => validate(buildZip([])))).toBe('BUNDLE_MANIFEST_MISSING');
    });
    it('manifest not first', () => {
      expect(code(() => validate(packBundle(makeBundle(rows(3)), { manifestFirst: false })))).toBe('BUNDLE_MANIFEST_NOT_FIRST');
    });
    it('wrong part count', () => {
      expect(code(() => validate(tamper((b) => (b.manifest.part_count = 5))))).toBe('BUNDLE_PART_COUNT_MISMATCH');
      expect(code(() => validate(tamper((b) => b.manifest.parts.pop())))).toBe('BUNDLE_PART_COUNT_MISMATCH');
    });
    it('missing part', () => {
      const b = makeBundle(rows(6), { partSize: 3 });
      b.members.pop();
      expect(code(() => validate(packBundle(b)))).toBe('BUNDLE_PART_MISSING');
      expect(details(() => validate(packBundle(b)))).toEqual({ partNumber: 2 });
    });
    it('unexpected part or member', () => {
      const b = makeBundle(rows(3));
      expect(code(() => validate(packBundle(b, { extra: [{ name: 'notes.txt', data: Buffer.from('hello') }] })))).toBe('BUNDLE_UNEXPECTED_ENTRY');
      const second = makeBundle(rows(3));
      expect(code(() => validate(packBundle(b, { extra: [{ name: second.members[0].name, data: second.members[0].data }] })))).toBe('BUNDLE_UNEXPECTED_ENTRY');
    });
    it('parts not in manifest order', () => {
      const b = makeBundle(rows(6), { partSize: 3 });
      b.members.reverse();
      expect(code(() => validate(packBundle(b)))).toBe('BUNDLE_PART_ORDER_MISMATCH');
    });
    it('wrong row count', () => {
      const zip = tamper((b) => { b.manifest.parts[0].row_count -= 1; b.manifest.parts[1].row_count += 1; }, 7, 4); // parts of 4 + 3 rows; the sum still equals total_rows
      expect(code(() => validate(zip))).toBe('BUNDLE_PART_ROWS_MISMATCH');
      expect(details(() => validate(zip))).toEqual({ partNumber: 1 });
      expect(code(() => validate(tamper((b) => (b.manifest.total_rows = 7))))).toBe('BUNDLE_TOTAL_ROWS_MISMATCH');
    });
    it('wrong byte count', () => {
      const zip = tamper((b) => (b.manifest.parts[1].bytes += 1));
      expect(code(() => validate(zip))).toBe('BUNDLE_PART_BYTES_MISMATCH');
      expect(details(() => validate(zip))).toEqual({ partNumber: 2 });
    });
    it('wrong SHA-256 (also when the bytes and the length are unchanged)', () => {
      expect(code(() => validate(tamper((b) => (b.manifest.parts[0].sha256 = 'a'.repeat(64)))))).toBe('BUNDLE_PART_HASH_MISMATCH');
      const b = makeBundle(rows(3));
      b.members[0].data = Buffer.from(b.members[0].data.toString('utf8').replace('Person Number0', 'Person Number9'), 'utf8'); // same length, other content
      expect(code(() => validate(packBundle(b)))).toBe('BUNDLE_PART_HASH_MISMATCH');
    });
    it('malformed manifest', () => {
      const b = makeBundle(rows(3));
      expect(code(() => validate(packBundle(b, { manifestBytes: Buffer.from('{ not json') })))).toBe('BUNDLE_MANIFEST_MALFORMED');
      expect(code(() => validate(packBundle(b, { manifestBytes: Buffer.from('[1,2]') })))).toBe('BUNDLE_MANIFEST_MALFORMED');
      expect(code(() => validate(packBundle(b, { manifestBytes: Buffer.from([0xff, 0xfe, 0x00]) })))).toBe('BUNDLE_MANIFEST_MALFORMED');
      for (const mutate of [
        (m: any) => delete m.bundle_id,
        (m: any) => (m.surprise = 1), // a manifest with a field this contract does not have is refused, not interpreted
        (m: any) => (m.total_rows = '3'),
        (m: any) => (m.bundle_id = 'not-a-bundle'),
        (m: any) => (m.exported_at = 'yesterday'),
        (m: any) => (m.max_part_rows = 0),
        (m: any) => (m.max_part_rows = 10_001),
        (m: any) => (m.parts[0].extra = true),
        (m: any) => (m.parts[0].filename = 'orion_published_people_other.csv'),
        (m: any) => (m.parts[0].sha256 = 'XYZ'),
        (m: any) => (m.parts[0].bytes = BUNDLE_LIMITS.MAX_PART_BYTES + 1),
      ]) {
        const c = makeBundle(rows(3));
        mutate(c.manifest);
        expect(code(() => validate(packBundle(c)))).toBe('BUNDLE_MANIFEST_MALFORMED');
      }
      const future = makeBundle(rows(3));
      future.manifest.exported_at = new Date(Date.now() + 3 * 86_400_000).toISOString();
      expect(code(() => validate(packBundle(future)))).toBe('BUNDLE_MANIFEST_MALFORMED');
    });
    it('unsupported export version and format', () => {
      const v = makeBundle(rows(3)); v.manifest.export_version = '2';
      expect(code(() => validate(packBundle(v)))).toBe('BUNDLE_UNSUPPORTED_EXPORT_VERSION');
      const f = makeBundle(rows(3)); f.manifest.format = 'xlsx';
      expect(code(() => validate(packBundle(f)))).toBe('BUNDLE_UNSUPPORTED_FORMAT');
    });
    it('a manifest-only bundle (zero parts) has nothing to import', () => {
      const b = makeBundle([]);
      expect(b.manifest.part_count).toBe(0);
      expect(code(() => validate(packBundle(b)))).toBe('BUNDLE_EMPTY');
    });
    it('a part that is not a valid People export is refused whole, naming the part and the code only', () => {
      const b = makeBundle(rows(6), { partSize: 3 });
      const broken = b.members[1].data.toString('utf8').replace('relationship_id', 'relationship_ref');
      b.members[1].data = Buffer.from(broken, 'utf8');
      b.manifest.parts[1].bytes = b.members[1].data.length;
      b.manifest.parts[1].sha256 = require('crypto').createHash('sha256').update(b.members[1].data).digest('hex');
      const z = packBundle(b);
      expect(code(() => validate(z))).toBe('BUNDLE_PART_INVALID');
      expect(details(() => validate(z))).toEqual({ partNumber: 2, partCode: 'MISSING_COLUMNS' });
    });
    it('a part exported at another time than the manifest says is refused', () => {
      const b = makeBundle(rows(3));
      b.manifest.exported_at = '2026-09-30T10:00:00+00:00';
      expect(code(() => validate(packBundle(b)))).toBe('BUNDLE_PART_EXPORT_MISMATCH');
    });
    it('a JSON part declared as CSV (or the reverse) is refused', () => {
      const j = makeBundle(rows(3), { format: 'json' });
      j.manifest.format = 'csv';
      j.manifest.parts = j.manifest.parts.map((p) => ({ ...p, filename: p.filename.replace('.json', '.csv') }));
      j.members = j.members.map((m) => ({ ...m, name: m.name.replace('.json', '.csv') }));
      expect(code(() => validate(packBundle(j)))).toBe('BUNDLE_PART_INVALID');
    });
    it('base64 and size are checked before the archive is read', () => {
      expect(code(() => svc.validate('%%% not base64 %%%'))).toBe('BUNDLE_NOT_BASE64');
      expect(code(() => svc.validate(''))).toBe('BUNDLE_NOT_BASE64');
      expect(code(() => svc.validate('abc'))).toBe('BUNDLE_NOT_BASE64');
      const big = Buffer.alloc(BUNDLE_LIMITS.MAX_ZIP_BYTES + 1, 1);
      expect(code(() => validate(big))).toBe('BUNDLE_TOO_LARGE');
      expect(status(() => validate(big))).toBe(413);
    });
  });

  describe('ZIP security', () => {
    const limits = { maxZipBytes: 1 << 20, maxEntries: 10, maxEntryBytes: () => 1 << 16, maxTotalBytes: 1 << 18 };
    const asBundle = (spec: Parameters<typeof buildZip>[0]) => validate(buildZip(spec));
    const mini = Buffer.from('hello');

    it('path traversal', () => {
      for (const name of ['../evil.csv', 'a/../../evil.csv', '..', '../../etc/passwd', 'sub/part.csv', 'dir/', '..\\evil.csv']) {
        expect(code(() => asBundle([{ name: 'manifest.json', data: mini }, { name, data: mini }]))).toBe('BUNDLE_ZIP_UNSAFE_PATH');
      }
    });
    it('absolute paths, drive letters, NUL and control characters', () => {
      for (const name of ['/etc/passwd', '/manifest.json', 'C:\\Windows\\x.csv', 'C:evil.csv', 'a\u0000b.csv', 'a\nb.csv', 'with space.csv', 'tab\t.csv']) {
        expect(code(() => asBundle([{ name, data: mini }]))).toBe('BUNDLE_ZIP_UNSAFE_PATH');
      }
    });
    it('duplicate ZIP members, including a case-only difference', () => {
      expect(code(() => asBundle([{ name: 'manifest.json', data: mini }, { name: 'manifest.json', data: Buffer.from('other') }]))).toBe('BUNDLE_ZIP_DUPLICATE_ENTRY');
      expect(code(() => asBundle([{ name: 'manifest.json', data: mini }, { name: 'MANIFEST.json', data: mini }]))).toBe('BUNDLE_ZIP_DUPLICATE_ENTRY');
    });
    it('malformed ZIP: garbage, empty, truncated, wrong signature, damaged directory', () => {
      expect(code(() => validate(Buffer.from('this is not a zip file at all, just text')))).toBe('BUNDLE_ZIP_MALFORMED');
      expect(code(() => svc.validate(''))).toBe('BUNDLE_NOT_BASE64'); // an empty upload
      expect(code(() => validate(Buffer.alloc(10)))).toBe('BUNDLE_ZIP_MALFORMED');
      expect(code(() => validate(Buffer.from([0x50, 0x4b, 0x03, 0x04])))).toBe('BUNDLE_ZIP_MALFORMED');
      const good = packBundle(makeBundle(rows(3)));
      expect(code(() => validate(good.subarray(0, good.length - 10)))).toBe('BUNDLE_ZIP_MALFORMED');
      const bent = Buffer.from(good);
      bent.writeUInt32LE(0xdeadbeef, bent.length - 22 + 16); // central directory offset points nowhere
      expect(code(() => validate(bent))).toBe('BUNDLE_ZIP_MALFORMED');
      const lying = buildZip([{ name: 'manifest.json', data: mini }], { eocdEntries: 3 });
      expect(code(() => validate(lying))).toBe('BUNDLE_ZIP_MALFORMED');
    });
    it('a local header that disagrees with the directory is refused', () => {
      expect(code(() => asBundle([{ name: 'manifest.json', data: mini, localName: 'other.json' }]))).toBe('BUNDLE_ZIP_MALFORMED');
    });
    it('corrupt data: wrong CRC, wrong declared size, damaged deflate stream', () => {
      expect(code(() => asBundle([{ name: 'manifest.json', data: mini, declaredCrc: 12345 }]))).toBe('BUNDLE_ZIP_CORRUPT');
      expect(code(() => asBundle([{ name: 'manifest.json', data: mini, declaredUsize: 4 }]))).toBe('BUNDLE_ZIP_CORRUPT');
      expect(code(() => asBundle([{ name: 'manifest.json', data: mini, rawCompressed: Buffer.from([0xff, 0xff, 0xff, 0xff]), declaredCsize: 4 }]))).toBe('BUNDLE_ZIP_CORRUPT');
    });
    it('encrypted, unsupported method and ZIP64 are refused', () => {
      expect(code(() => asBundle([{ name: 'manifest.json', data: mini, flags: 1 }]))).toBe('BUNDLE_ZIP_UNSUPPORTED');
      const m9 = buildZip([{ name: 'manifest.json', data: mini }]);
      m9.writeUInt16LE(9, m9.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 10); // central directory method 9 (deflate64)
      expect(code(() => validate(m9))).toBe('BUNDLE_ZIP_UNSUPPORTED');
      expect(code(() => asBundle([{ name: 'manifest.json', data: mini, declaredUsize: 0xffffffff }]))).toBe('BUNDLE_ZIP_UNSUPPORTED');
    });
    it('oversized extraction: an entry that declares more than allowed is refused before it is inflated', () => {
      const bomb = deflateRawSync(Buffer.alloc(BUNDLE_LIMITS.MAX_PART_BYTES + 1024, 0)); // tiny on disk, huge when inflated
      expect(bomb.length).toBeLessThan(40_000);
      const z = buildZip([{ name: 'manifest.json', data: Buffer.alloc(0), rawCompressed: Buffer.from([0x03, 0x00]) }, { name: 'orion_published_people_20261001T100000Z_aabbccdd_part-0001-of-0001.csv', data: Buffer.alloc(0), rawCompressed: bomb, declaredUsize: BUNDLE_LIMITS.MAX_PART_BYTES + 1024 }]);
      expect(code(() => validate(z))).toBe('BUNDLE_ZIP_TOO_LARGE');
      expect(status(() => validate(z))).toBe(413);
      const bigManifest = buildZip([{ name: 'manifest.json', data: Buffer.alloc(0), rawCompressed: deflateRawSync(Buffer.alloc(BUNDLE_LIMITS.MAX_MANIFEST_BYTES + 1)), declaredUsize: BUNDLE_LIMITS.MAX_MANIFEST_BYTES + 1 }]);
      expect(code(() => validate(bigManifest))).toBe('BUNDLE_ZIP_TOO_LARGE');
    });
    it('oversized extraction: many entries that together expand beyond the total limit', () => {
      const each = BUNDLE_LIMITS.MAX_PART_BYTES - 10;
      const spec = Array.from({ length: 6 }, (_, i) => ({ name: `part${i}.csv`, data: Buffer.alloc(0), rawCompressed: Buffer.from([0x03, 0x00]), declaredUsize: each }));
      expect(each * 6).toBeGreaterThan(BUNDLE_LIMITS.MAX_TOTAL_BYTES);
      expect(code(() => asBundle([{ name: 'manifest.json', data: mini }, ...spec]))).toBe('BUNDLE_ZIP_TOO_LARGE');
    });
    it('oversized extraction: an archive that LIES about its sizes cannot expand beyond what it declared', () => {
      const real = Buffer.alloc(8 * 1024 * 1024, 7);
      const z = buildZip([{ name: 'manifest.json', data: Buffer.alloc(0), rawCompressed: deflateRawSync(real), declaredUsize: 1000, declaredCrc: 0 }]);
      expect(code(() => validate(z))).toBe('BUNDLE_ZIP_CORRUPT'); // stopped by maxOutputLength, not by inflating 8 MiB
      expect(() => readZip(z, { ...limits, maxEntryBytes: () => 1 << 20 })).toThrow();
    });
    it('excessive part count: more than 500 parts in the manifest, or more than 501 archive entries', () => {
      const b = makeBundle(rows(3));
      b.manifest.part_count = BUNDLE_LIMITS.MAX_PARTS + 1;
      expect(code(() => validate(packBundle(b)))).toBe('BUNDLE_TOO_MANY_PARTS');
      const many = Array.from({ length: BUNDLE_LIMITS.MAX_PARTS + 2 }, (_, i) => ({ name: `e${i}.csv`, data: Buffer.from('x') }));
      expect(code(() => asBundle(many))).toBe('BUNDLE_ZIP_TOO_MANY_ENTRIES');
      expect(status(() => asBundle(many))).toBe(413);
    });
    it('a ZIP file is never written anywhere: the reader works on memory only', () => {
      const fs = require('fs');
      const spy = jest.spyOn(fs, 'writeFileSync');
      validate(packBundle(makeBundle(rows(3))));
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
    it('error messages never echo entry content or names from the archive', () => {
      let message = '';
      try {
        asBundle([{ name: '../super-secret-name.csv', data: Buffer.from('SECRET-CONTENT') }]);
      } catch (e) {
        message = JSON.stringify({ m: (e as Error).message, d: (e as BusinessException).details });
      }
      expect(message).not.toMatch(/super-secret|SECRET-CONTENT/);
      void sha;
    });
  });
});
