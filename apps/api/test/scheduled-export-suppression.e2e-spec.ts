import supertest from 'supertest';
const request = (supertest as any).default || supertest;
import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { eq, like } from 'drizzle-orm';
import { TestAppHelper } from './helpers/test-app.helper';
import * as schema from '../src/database/schema';
import { ExportService } from '../src/modules/export/export.service';
import { ContactSuppressionService } from '../src/modules/privacy/contact-suppression.service';

/**
 * Phase 23, independent check of the Phase 22 claim "stored scheduled-export files are expired when a contact is suppressed".
 * Unlike the Phase 22 tests this one goes through the real HTTP download route and the real scheduler method, and also proves the audit
 * entry is written when the service is resolved from the running application (module wiring), without containing the value.
 * Synthetic data only.
 */
const binary = (res: any, cb: (e: Error | null, b?: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('Stored scheduled exports and company-contact suppression (Phase 23)', () => {
  let testApp: TestAppHelper;
  let app: INestApplication;
  const api = () => request(app.getHttpServer());
  const unwrap = (res: any) => res.body.data || res.body;
  const tag = `zzp23${Date.now()}`;
  const slug = `${tag}-co`;
  const emails: string[] = [];
  const HELD = `held.${tag}@acme-example.com`;
  const KEPT = `kept.${tag}@acme-example.com`;
  let bizId = '';
  let auth: { Authorization: string };

  beforeAll(async () => {
    testApp = new TestAppHelper();
    app = await testApp.init();
    const biz = await testApp.createTestBusiness({ slug, name: `${tag} Co`, contactEmail: HELD, contactPhone: '+91 9000000099' });
    bizId = biz.id;
    await testApp.db.insert(schema.businessContacts).values({ businessId: bizId, fullName: 'Second Contact', email: KEPT, phone: null } as any);
    const email = `p23.${Date.now()}@orion-test.io`;
    emails.push(email);
    const reg = unwrap(await api().post('/api/v1/auth/register').send({ email, password: 'Phase23Pass123!', firstName: 'Pt', lastName: 'Tw' }));
    auth = { Authorization: `Bearer ${reg.tokens.accessToken}` };
    (app.get(ThrottlerStorage) as any).storage.clear();
    expect((await api().post('/api/v1/unlock/business').set(auth).send({ businessId: bizId })).status).toBe(200);
  });

  afterAll(async () => {
    const biz = await testApp.db.select({ slug: schema.businesses.slug }).from(schema.businesses).where(like(schema.businesses.slug, `${tag}%`));
    await testApp.cleanupBusinesses(biz.map((b) => b.slug));
    await testApp.cleanupUsers(emails);
    await testApp.close();
  });

  const storedJobs = async () => {
    const hist = unwrap(await api().get('/api/v1/exports/history').set(auth));
    const rows = (Array.isArray(hist) ? hist : (hist.items ?? hist.history ?? [])) as any[];
    return rows.filter((r) => r.source === 'SCHEDULED');
  };
  const download = (id: string) => api().get(`/api/v1/exports/${id}/download`).set(auth).buffer(true).parse(binary);

  it('a stored file holds the value, is downloadable, and after a suppression is gone (410) while the history row remains', async () => {
    const sch = await api().post('/api/v1/exports/schedules').set(auth).send({ dataset: 'unlocked-leads', format: 'csv', frequency: 'DAILY' });
    expect([200, 201]).toContain(sch.status);
    await app.get(ExportService).runDueSchedules(new Date(Date.now() + 3 * 86400000));

    const before = await storedJobs();
    expect(before.length).toBeGreaterThanOrEqual(1);
    const jobId = before[0].id as string;
    const first = await download(jobId);
    expect(first.status).toBe(200);
    const text = (first.body as Buffer).toString('utf8');
    expect(text).toContain(HELD); // the premise: the stored file really contains the value
    expect(text).toContain(KEPT);

    const result = await app.get(ContactSuppressionService).suppress({ kind: 'EMAIL', value: HELD, reasonCode: 'REMOVAL' });
    expect(result.contactsRemoved).toBe(1);
    expect(result.storedExportsExpired).toBeGreaterThanOrEqual(1);

    const gone = await download(jobId);
    expect(gone.status).toBe(410);
    expect((gone.body as Buffer).toString('utf8')).not.toContain(HELD);
    const [row] = await testApp.db.select().from(schema.exportJobs).where(eq(schema.exportJobs.id, jobId));
    expect(row).toMatchObject({ status: 'EXPIRED', content: null });
    expect(row.fileName).toBeTruthy(); // history survives
  });

  it('the next scheduled run produces a clean file: the removed value is absent and the other contact is still there', async () => {
    await app.get(ExportService).runDueSchedules(new Date(Date.now() + 6 * 86400000));
    const jobs = (await storedJobs()).filter((j) => j.status === 'COMPLETED');
    expect(jobs.length).toBeGreaterThanOrEqual(1);
    const res = await download(jobs[0].id);
    expect(res.status).toBe(200);
    const text = (res.body as Buffer).toString('utf8');
    expect(text).not.toContain(HELD);
    expect(text).toContain(KEPT);
  });

  it('the suppression was audited through the running application, with no contact value in the entry', async () => {
    const rows = (await testApp.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, 'CONTACT_SUPPRESSION_ADDED'))) as any[];
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const mine = rows.find((r) => r.newValues?.kind === 'EMAIL' && r.newValues?.contactsRemoved === 1);
    expect(mine).toBeDefined();
    expect(JSON.stringify(mine)).not.toContain(HELD);
    expect(JSON.stringify(mine)).not.toContain(tag);
  });
});
