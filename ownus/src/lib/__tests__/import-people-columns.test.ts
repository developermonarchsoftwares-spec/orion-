import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  FALLBACK_PEOPLE_NOTICE,
  canonicalPersonColumn,
  countRowsWithPeopleData,
  isPersonColumn,
  withoutPersonColumns,
} from '../import-people-columns.ts';

const ROUTE = resolve(import.meta.dirname, '../../app/api/v1/[...path]/route.ts');
const routeSource = readFileSync(ROUTE, 'utf8');

// Same columns as PEOPLE_TEMPLATE_COLUMNS in the Nest import module (parity is also asserted from the template CSV).
const PEOPLE_COLUMNS = [
  'person_email', 'person_phone', 'person_mobile', 'person_linkedin',
  ...[2, 3, 4, 5].flatMap((n) => ['name', 'title', 'email', 'phone', 'mobile', 'linkedin'].map((f) => `person_${n}_${f}`)),
];

describe('fallback importer: people columns', () => {
  it('recognises every documented people column and nothing else', () => {
    for (const c of PEOPLE_COLUMNS) assert.equal(canonicalPersonColumn(c), c, c);
    assert.equal(canonicalPersonColumn('Person 2 Email'), 'person_2_email');
    assert.equal(canonicalPersonColumn('PERSON-3-LINKEDIN'), 'person_3_linkedin');
    for (const c of ['email', 'phone', 'contact_person', 'contact_title', 'personal_email', 'person_6_name', 'person_2_salary', 'website']) {
      assert.equal(isPersonColumn(c), false, c);
    }
  });

  it('every people column in the gateway template is recognised', () => {
    const header = /const CANONICAL_TEMPLATE_CSV = `([^\n`]+)/.exec(routeSource)![1].split(',');
    const personCols = header.filter((h) => h.startsWith('person_'));
    assert.ok(personCols.length >= 16);
    for (const c of personCols) assert.equal(isPersonColumn(c), true, c);
  });

  it('withoutPersonColumns keeps company columns only, so a person value can never become a company field', () => {
    const row = { business_name: 'ABC Technologies', email: 'info@abc.in', person_email: 'arun@abc.in', person_2_phone: '9876543210' };
    assert.deepEqual(withoutPersonColumns(row), { business_name: 'ABC Technologies', email: 'info@abc.in' });
  });

  it('counts only rows that actually carry people data and reports honestly', () => {
    const rows = [
      { business_name: 'A', person_email: 'a@abc.in' },
      { business_name: 'B', person_email: '  ', person_2_name: '' },
      { business_name: 'C' },
      { business_name: 'D', person_3_title: 'CEO' },
    ];
    assert.equal(countRowsWithPeopleData(rows), 2);
    assert.match(FALLBACK_PEOPLE_NOTICE, /not processed/);
  });

  it('route: person columns keep their own key in header mapping and are excluded from company scans', () => {
    assert.match(routeSource, /const personColumn = canonicalPersonColumn\(key\);\s*if \(personColumn\) return personColumn;/);
    // all four "any value" scans use the company-only view of the row
    const scan = routeSource.slice(routeSource.indexOf('// Intra-Row Fallback Auto-Detection'), routeSource.indexOf('const businessName = mapped.business_name'));
    assert.equal((scan.match(/Object\.entries\(companyOnlyRaw\)/g) ?? []).length, 4);
    assert.doesNotMatch(scan, /Object\.entries\(raw\)/);
    assert.match(routeSource, /peopleColumns: peopleFallbackReport\(rows\)/g);
  });

  it('route: the fallback writes nothing to the People layer', () => {
    const fallback = routeSource.slice(routeSource.indexOf('async function handleAdminImportSubmit'), routeSource.indexOf('function getBackendUrl'));
    assert.doesNotMatch(fallback, /\b(company_people|people_evidence|person_contacts|people_ingestion_quarantine|INTO people\b)/);
    assert.doesNotMatch(fallback, /Primary Contact|Director\/Owner/);
  });
});
