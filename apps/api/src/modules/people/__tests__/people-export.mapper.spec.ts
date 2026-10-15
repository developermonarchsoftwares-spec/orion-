import {
  PEOPLE_EXPORT_COLUMNS,
  PEOPLE_EXPORT_RECORD_FIELDS,
  PeopleExportFormatError,
  exportBatchRef,
  mapExportRow,
  mapExportRows,
  parseExportCsv,
  parseExportJson,
} from '../ingestion/sources/people-export.mapper';
import { normalizeRawPerson } from '../ingestion/person-record.normalizer';
import { exportRow, toCsv, toJson } from './people-export-fixtures';

const RID = '0d3c4a8e-1111-4222-8333-444455556666';

const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof PeopleExportFormatError) return e.code;
    throw e;
  }
  return 'NO_ERROR';
};

describe('People export mapper (Phase 8A)', () => {
  it('knows the frozen 38 fields in the frozen order', () => {
    expect(PEOPLE_EXPORT_COLUMNS).toHaveLength(38);
    expect(PEOPLE_EXPORT_COLUMNS[0]).toBe('export_version');
    expect(PEOPLE_EXPORT_COLUMNS[37]).toBe('source_acquired_at');
    expect(PEOPLE_EXPORT_RECORD_FIELDS).toHaveLength(36);
  });

  describe('parsing', () => {
    it('parses CSV and JSON of the same rows to the same data', () => {
      const rows = [exportRow({ full_name: 'Asha Rao', email: 'asha@acme.example' }), exportRow({ full_name: 'Bimal Das', company_name: 'Acme, "Inc"' })];
      const c = parseExportCsv(toCsv(rows));
      const j = parseExportJson(toJson(rows));
      expect(c.exportVersion).toBe('1');
      expect(c.exportedAt.toISOString()).toBe('2026-10-01T10:00:00.000Z');
      expect(c.rows.map((r) => r.full_name)).toEqual(['Asha Rao', 'Bimal Das']);
      expect(c.rows[1].company_name).toBe('Acme, "Inc"');
      for (const k of PEOPLE_EXPORT_RECORD_FIELDS) expect(c.rows.map((r) => r[k])).toEqual(j.rows.map((r) => r[k]));
    });

    it('ignores unknown extra columns and keys, and accepts a BOM', () => {
      const rows = [exportRow()];
      const csv = '﻿' + toCsv(rows).replace('export_version,', 'unrelated,export_version,').replace('\r\n1,', '\r\nzzz,1,');
      expect(parseExportCsv(csv).rows).toHaveLength(1);
      const j = JSON.parse(toJson(rows));
      j.people[0].surprise = 'x';
      expect(parseExportJson(JSON.stringify(j)).rows).toHaveLength(1);
    });

    it('undoes the export CSV formula guard, and only that', () => {
      const rows = [exportRow({ job_title: "'=CMD()", full_name: "O'Brien Rao", email: "'@x@y.example", phone: '+919811122233' })];
      const r = parseExportCsv(toCsv(rows)).rows[0];
      expect(r.job_title).toBe('=CMD()');
      expect(r.email).toBe('@x@y.example');
      expect(r.full_name).toBe("O'Brien Rao");
      expect(r.phone).toBe('+919811122233');
    });

    const withoutName = PEOPLE_EXPORT_COLUMNS.filter((c) => c !== 'full_name');
    it.each([
      ['empty file', '', 'EMPTY_EXPORT'],
      ['header only', toCsv([]), 'EMPTY_EXPORT'],
      ['a missing column', toCsv([exportRow()], withoutName), 'MISSING_COLUMNS'],
      ['a repeated column', toCsv([exportRow()]).replace('full_name,', 'full_name,full_name,'), 'DUPLICATE_HEADERS'],
      ['a short row', toCsv([exportRow()]) + 'a,b,c\r\n', 'MALFORMED_CSV'],
      ['a NUL byte', toCsv([exportRow()]) + '\u0000', 'MALFORMED_CSV'],
      ['a wrong version', toCsv([exportRow({ export_version: '2' })]), 'UNSUPPORTED_EXPORT_VERSION'],
      ['a bad exported_at', toCsv([exportRow({ exported_at: 'last tuesday' })]), 'INVALID_EXPORTED_AT'],
      ['a future exported_at', toCsv([exportRow({ exported_at: '2999-01-01T00:00:00Z' })]), 'INVALID_EXPORTED_AT'],
      ['rows that disagree on exported_at', toCsv([exportRow(), exportRow({ exported_at: '2026-10-01T11:00:00+00:00' })]), 'INCONSISTENT_ENVELOPE'],
    ])('rejects CSV with %s', (_n, text, code) => {
      expect(codeOf(() => parseExportCsv(text))).toBe(code);
    });

    it.each([
      ['not JSON', '{nope', 'MALFORMED_JSON'],
      ['an array', '[]', 'MALFORMED_JSON'],
      ['no people array', JSON.stringify({ export_version: '1', exported_at: '2026-10-01T10:00:00Z', record_count: 0 }), 'MALFORMED_JSON'],
      ['no people', JSON.stringify({ export_version: '1', exported_at: '2026-10-01T10:00:00Z', record_count: 0, people: [] }), 'EMPTY_EXPORT'],
      ['a wrong version', toJson([exportRow()], { export_version: '9' }), 'UNSUPPORTED_EXPORT_VERSION'],
      ['a numeric version', toJson([exportRow()], { export_version: 1 }), 'UNSUPPORTED_EXPORT_VERSION'],
      ['a bad exported_at', toJson([exportRow()], { exported_at: 'x' }), 'INVALID_EXPORTED_AT'],
      ['a record_count mismatch', toJson([exportRow()], { record_count: 5 }), 'RECORD_COUNT_MISMATCH'],
      ['a non-object person', toJson([exportRow()], { people: [{}, 'x'], record_count: 2 }), 'MALFORMED_JSON'],
    ])('rejects JSON with %s', (_n, text, code) => {
      expect(codeOf(() => parseExportJson(text))).toBe(code);
    });

    it('rejects JSON people that lack the frozen keys, naming only the keys', () => {
      const j = JSON.parse(toJson([exportRow()]));
      delete j.people[0].job_title;
      let err: PeopleExportFormatError | undefined;
      try {
        parseExportJson(JSON.stringify(j));
      } catch (e) {
        err = e as PeopleExportFormatError;
      }
      expect(err?.code).toBe('MISSING_COLUMNS');
      expect(err?.details).toEqual({ columns: ['job_title'] });
    });

    it('rejects an object or array where a scalar is expected', () => {
      const j = JSON.parse(toJson([exportRow()]));
      j.people[0].full_name = { a: 1 };
      expect(codeOf(() => parseExportJson(JSON.stringify(j)))).toBe('INVALID_FIELD_TYPE');
    });

    it('error messages never contain row content', () => {
      let err: PeopleExportFormatError | undefined;
      try {
        parseExportCsv(toCsv([exportRow({ full_name: 'SECRET Person', email: 'secret@leak.example' })]) + 'secret@leak.example,x\r\n');
      } catch (e) {
        err = e as PeopleExportFormatError;
      }
      expect(err).toBeDefined();
      expect(JSON.stringify([err!.message, err!.details])).not.toMatch(/secret/i);
    });
  });

  describe('row mapping', () => {
    const mapped = (over: Record<string, string | null> = {}) => {
      const m = mapExportRow(parseExportJson(toJson([exportRow(over)])).rows[0]);
      if (typeof m === 'string') throw new Error(m);
      return m;
    };

    it('maps company, person and provenance, and nothing source-local or authoritative', () => {
      const m = mapped({
        relationship_id: RID, company_name: 'Acme Works', company_city: 'Pune', company_state: 'Maharashtra', gstin: '27aaact2727q1zw',
        cin: 'L22210MH1995PLC084781', pan: 'AAACT2727Q', full_name: 'Asha Rao', email: 'asha@acme.example', phone: '+912025550100',
        mobile: '+919811122233', linkedin_url: 'https://www.linkedin.com/in/asha-rao', person_city: 'Pune', person_state: 'Maharashtra',
        person_country: 'India',
      });
      expect(m).toEqual({
        company: {
          name: 'Acme Works', city: 'Pune', state: 'Maharashtra',
          identifiers: [{ type: 'GSTIN', value: '27AAACT2727Q1ZW' }, { type: 'CIN', value: 'L22210MH1995PLC084781' }, { type: 'PAN', value: 'AAACT2727Q' }],
        },
        personName: 'Asha Rao', jobTitle: 'Chief Executive Officer', email: 'asha@acme.example', phone: '+912025550100', mobile: '+919811122233',
        linkedinUrl: 'https://www.linkedin.com/in/asha-rao', city: 'Pune', state: 'Maharashtra', country: 'India',
        source: { type: 'MANUAL_IMPORT', label: 'people-pipeline-export:PEOPLE_FILE', recordId: RID, observedAt: '2026-09-30T09:00:00+00:00' },
      });
      const text = JSON.stringify(m);
      for (const forbidden of ['businessId', 'businessSlug', 'businessIdentifier', 'department', 'seniority', 'decisionMakerType', 'verification', 'confidenceScore', 'isPublished']) {
        expect(text).not.toContain(`"${forbidden}"`);
      }
      expect(text).not.toContain('source-local-slug');
    });

    it('produces a record the existing normalizer accepts (no hint conflicts, no forbidden fields)', () => {
      const r = normalizeRawPerson(mapped({ company_name: 'Acme', company_city: 'Pune', company_state: 'Maharashtra' }));
      expect(r.ok).toBe(true);
    });

    it('uses source_acquired_at as observedAt only when last_seen_at is absent; no provider gives a plain label; an unsafe provider is dropped', () => {
      expect(mapped({ last_seen_at: null }).source?.observedAt).toBe('2026-09-28T09:00:00+00:00');
      expect(mapped({ last_seen_at: null, source_acquired_at: null }).source).not.toHaveProperty('observedAt');
      expect(mapped({ source_provider: null }).source?.label).toBe('people-pipeline-export');
      expect(mapped({ source_provider: 'bad provider; DROP' }).source?.label).toBe('people-pipeline-export');
    });

    it('rejects rows that cannot be keyed or carry a malformed statutory identifier, by code only', () => {
      const row = (over: Record<string, string | null>) => mapExportRow(parseExportJson(toJson([exportRow(over)])).rows[0]);
      expect(row({ relationship_id: null })).toBe('MISSING_RELATIONSHIP_ID');
      expect(row({ relationship_id: 'not-a-uuid' })).toBe('INVALID_RELATIONSHIP_ID');
      expect(row({ gstin: '123' })).toBe('INVALID_COMPANY_IDENTIFIER');
      expect(row({ cin: 'X' })).toBe('INVALID_COMPANY_IDENTIFIER');
      expect(row({ pan: 'ABC' })).toBe('INVALID_COMPANY_IDENTIFIER');
    });

    it('rejects a repeated relationship_id after the first', () => {
      const rows = parseExportJson(toJson([exportRow({ relationship_id: RID }), exportRow({ relationship_id: RID.toUpperCase() })])).rows;
      const out = mapExportRows(rows);
      expect(out.records).toHaveLength(1);
      expect(out.rejected).toEqual([{ row: 2, code: 'DUPLICATE_RELATIONSHIP_ID' }]);
    });

    it('leaves missing name / title / contacts to the ingestion layer', () => {
      const m = mapped({ full_name: null, job_title: null, email: null });
      expect(m.personName).toBeUndefined();
      expect(m.jobTitle).toBeUndefined();
      expect(m.email).toBeUndefined();
    });
  });

  describe('run id', () => {
    it('is deterministic per file content and differs between exports', () => {
      const one = (over: Record<string, string | null> = {}) => parseExportJson(toJson([exportRow({ relationship_id: RID, person_id: RID, business_id: RID, master_business_id: RID, ...over })]));
      expect(exportBatchRef(one())).toBe(exportBatchRef(one()));
      expect(exportBatchRef(one())).not.toBe(exportBatchRef(one({ exported_at: '2026-10-02T10:00:00+00:00' })));
      expect(exportBatchRef(one())).not.toBe(exportBatchRef(one({ job_title: 'Director' })));
      expect(exportBatchRef(one())).toMatch(/^people-export-v1-[0-9a-f]{24}$/);
      expect(exportBatchRef(one()).length).toBeLessThanOrEqual(100);
    });
  });
});
