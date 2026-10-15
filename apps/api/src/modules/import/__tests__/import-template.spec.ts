import * as fs from 'fs';
import * as path from 'path';
import { parseCsv } from '../../people/ingestion/sources/people-sources';
import { extractPeopleFromRow } from '../people/import-people.bridge';
import {
  EXTRA_PERSON_TEMPLATE_COLUMNS,
  PEOPLE_TEMPLATE_COLUMNS,
  PERSON_1_TEMPLATE_COLUMNS,
} from '../people/import-people.types';
import { AdminImportService } from '../services/admin-import.service';

const REPO_ROOT = path.resolve(__dirname, '../../../../../..');
const norm = (s: string) => s.replace(/\r\n/g, '\n');
const COMPANY_COLUMNS = [
  'business_name', 'legal_name', 'gstin', 'cin', 'pan', 'address_line1', 'city', 'district', 'state', 'pincode',
  'phone', 'email', 'website', 'contact_person', 'contact_title', 'business_type', 'msme_category', 'industry',
  'category', 'description', 'founding_year',
];
const prov = { batchId: 'b', filename: 't.csv', rowNumber: 1, observedAt: new Date('2026-01-01') };

describe('company upload CSV template documents the supported people fields', () => {
  const service: any = new (AdminImportService as any)();
  const nestCsv = (): string => {
    // getCanonicalTemplateCsv does not use injected dependencies
    return AdminImportService.prototype.getCanonicalTemplateCsv.call(service);
  };

  it('has the existing company columns unchanged, followed by the people columns', () => {
    const [header] = parseCsv(nestCsv());
    expect(header).toEqual([...COMPANY_COLUMNS, ...PEOPLE_TEMPLATE_COLUMNS]);
    expect(PEOPLE_TEMPLATE_COLUMNS).toEqual([
      'person_email', 'person_phone', 'person_mobile', 'person_linkedin',
      'person_2_name', 'person_2_title', 'person_2_email', 'person_2_phone', 'person_2_mobile', 'person_2_linkedin',
      'person_3_name', 'person_3_title', 'person_3_email', 'person_3_phone', 'person_3_mobile', 'person_3_linkedin',
    ]);
  });

  it('every row has exactly as many cells as the header', () => {
    const rows = parseCsv(nestCsv());
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const r of rows) expect(r).toHaveLength(COMPANY_COLUMNS.length + PEOPLE_TEMPLATE_COLUMNS.length);
  });

  it('samples invent no people: person-level contact cells are blank', () => {
    const [header, ...rows] = parseCsv(nestCsv());
    for (const r of rows) {
      for (const col of PEOPLE_TEMPLATE_COLUMNS) expect(r[header.indexOf(col)]).toBe('');
    }
  });

  it('the backend template, docs/ORION_IMPORT_TEMPLATE.csv and the gateway download are identical', () => {
    const docs = norm(fs.readFileSync(path.join(REPO_ROOT, 'docs/ORION_IMPORT_TEMPLATE.csv'), 'utf8'));
    expect(norm(nestCsv())).toBe(docs);

    const gateway = fs.readFileSync(path.join(REPO_ROOT, 'ownus/src/app/api/v1/[...path]/route.ts'), 'utf8');
    const begin = gateway.indexOf('// BEGIN CANONICAL TEMPLATE');
    const end = gateway.indexOf('// END CANONICAL TEMPLATE');
    expect(begin).toBeGreaterThan(-1);
    const literal = gateway.slice(begin, end).match(/= `([\s\S]*)`;/)![1];
    expect(norm(literal)).toBe(docs);
  });

  it('every people column is understood by the upload (round trip through the real header mapper)', () => {
    const cells: Record<string, string> = {
      business_name: 'Sample Traders Pvt Ltd', city: 'Pune', state: 'Maharashtra',
      email: 'info@sample-traders.example', phone: '+91 20 5550 0100', website: 'https://sample-traders.example',
      contact_person: 'Person One', contact_title: 'Managing Director',
      person_email: 'one@sample-traders.example', person_phone: '+91 20 5550 0101', person_mobile: '98765 43210', person_linkedin: 'linkedin.com/in/person-one',
      person_2_name: 'Person Two', person_2_title: 'Head of Procurement', person_2_email: 'two@sample-traders.example', person_2_phone: '+91 20 5550 0102', person_2_mobile: '98765 43211', person_2_linkedin: 'linkedin.com/in/person-two',
      person_3_name: 'Person Three', person_3_title: 'CFO', person_3_email: 'three@sample-traders.example', person_3_phone: '+91 20 5550 0103', person_3_mobile: '98765 43212', person_3_linkedin: 'linkedin.com/in/person-three',
    };
    const mapped = service.mapRowHeaders(cells);
    const people = extractPeopleFromRow(mapped, 'biz', prov);
    expect(people.map((p) => p.personName)).toEqual(['Person One', 'Person Two', 'Person Three']);
    expect(people[0]).toMatchObject({ jobTitle: 'Managing Director', email: 'one@sample-traders.example', phone: '+91 20 5550 0101', mobile: '98765 43210', linkedinUrl: 'linkedin.com/in/person-one' });
    expect(people[1]).toMatchObject({ jobTitle: 'Head of Procurement', email: 'two@sample-traders.example', mobile: '98765 43211', linkedinUrl: 'linkedin.com/in/person-two' });
    expect(people[2]).toMatchObject({ jobTitle: 'CFO', phone: '+91 20 5550 0103', linkedinUrl: 'linkedin.com/in/person-three' });
    // the company's own email / phone are not on any person
    expect(JSON.stringify(people)).not.toMatch(/info@sample-traders|5550 0100/);
    // each column listed in the template is consumed
    expect(PERSON_1_TEMPLATE_COLUMNS.length + EXTRA_PERSON_TEMPLATE_COLUMNS.length).toBe(PEOPLE_TEMPLATE_COLUMNS.length);
    for (const col of PEOPLE_TEMPLATE_COLUMNS) {
      const only = service.mapRowHeaders({ business_name: 'X Traders', contact_person: 'Base Person', [col]: 'value-for-column' });
      const extracted = JSON.stringify(extractPeopleFromRow(only, 'biz', prov));
      expect(extracted).toContain('value-for-column');
    }
  });

  it('company-level columns alone never create a person', () => {
    const mapped = service.mapRowHeaders({
      business_name: 'Only Company Pvt Ltd', city: 'Pune', state: 'Maharashtra',
      email: 'sales@only-company.example', phone: '+91 20 5550 0100', website: 'https://only-company.example', contact_title: 'Director',
    });
    expect(extractPeopleFromRow(mapped, 'biz', prov)).toEqual([]);
  });

  it('people 4 and 5 follow the same pattern; anything beyond 5 is ignored', () => {
    const raw: Record<string, unknown> = {};
    for (let n = 2; n <= 7; n++) {
      raw[`person_${n}_name`] = `Person ${n}`;
      raw[`person_${n}_title`] = 'Director';
    }
    expect(extractPeopleFromRow(raw, 'biz', prov).map((p) => p.personName)).toEqual(['Person 2', 'Person 3', 'Person 4', 'Person 5']);
  });
});
