import { assessBatchIntegrity } from './batch-integrity';
import { emptyPeopleSummary } from '../people/import-people.types';

const good = { totalRows: 58, recordCount: 58, successful: 58, duplicates: 0, failed: 0, businessesPublished: 58, peopleSummary: emptyPeopleSummary() };

describe('assessBatchIntegrity', () => {
  it('passes a consistent batch', () => expect(assessBatchIntegrity(good)).toEqual({ ok: true, issues: [] }));
  it('flags missing import_records (the gateway bug)', () => {
    const r = assessBatchIntegrity({ ...good, recordCount: 0 });
    expect(r.ok).toBe(false);
    expect(r.issues[0]).toMatch(/import_records 0 != rows submitted 58/);
  });
  it('flags a missing people_summary', () => expect(assessBatchIntegrity({ ...good, peopleSummary: null }).issues).toEqual(['people_summary was not generated']));
  it('flags outcome and publish mismatches', () => {
    const r = assessBatchIntegrity({ ...good, successful: 50, duplicates: 2, failed: 1, businessesPublished: 49 });
    expect(r.issues).toHaveLength(2);
  });
  it('accepts duplicates and failures when they add up', () =>
    expect(assessBatchIntegrity({ ...good, successful: 50, duplicates: 5, failed: 3, businessesPublished: 50 }).ok).toBe(true));
});
