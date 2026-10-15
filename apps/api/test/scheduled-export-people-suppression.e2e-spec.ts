import supertest from 'supertest';
const request = (supertest as any).default || supertest;
import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { eq, like } from 'drizzle-orm';
import { TestAppHelper } from './helpers/test-app.helper';
import * as schema from '../src/database/schema';
import { ExportService } from '../src/modules/export/export.service';
import { PeoplePublishingService } from '../src/modules/people/people-publishing.service';

/**
 * Phase 23: adjacent-path check for the Phase 22 stored-export fix. A scheduled export of the `unlocked-people` dataset stores a file that
 * contains a person's contact values. Suppressing that person (the People registry, a different mechanism from the company-contact
 * register) must also expire the stored file, otherwise the removal request leaves a downloadable copy until the file expires by itself.
 * Synthetic data only.
 */
const binary = (res: any, cb: (e: Error | null, b?: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('Stored scheduled exports and People suppression (Phase 23)', () => {
  let testApp: TestAppHelper;
  let app: INestApplication;
  const api = () => request(app.getHttpServer());
  const unwrap = (res: any) => res.body.data || res.body;
  const tag = `zzp23p${Date.now()}`;
  const emails: string[] = [];
  const PERSON_EMAIL = `ravi.${tag}@meridian-example.com`;
  let personId = '';
  let auth: { Authorization: string };

  beforeAll(async () => {
    testApp = new TestAppHelper();
    app = await testApp.init();
    const biz = await testApp.createTestBusiness({ slug: `${tag}-co`, name: `${tag} Co`, contactEmail: `info.${tag}@meridian-example.com`, contactPhone: '+91 9000000098' });
    const db = testApp.db as any;
    const [person] = await db.insert(schema.people).values({ fullName: 'Ravi Testperson', normalizedName: `ravi testperson ${tag}`, dataStatus: 'PUBLISHED', normalizedLinkedinUrl: `linkedin.com/in/${tag}` }).returning();
    personId = person.id;
    await db.insert(schema.companyPeople).values({ businessId: biz.id, personId, jobTitleAtCompany: 'Director', normalizedJobTitle: 'director', isCurrent: true, isPublished: true, reviewStatus: 'APPROVED' });
    await db.insert(schema.personContacts).values({ personId, contactType: 'WORK_EMAIL', contactValue: PERSON_EMAIL, normalizedValue: PERSON_EMAIL, isPublished: true });
    const email = `p23p.${Date.now()}@orion-test.io`;
    emails.push(email);
    const reg = unwrap(await api().post('/api/v1/auth/register').send({ email, password: 'Phase23Pass123!', firstName: 'Pt', lastName: 'Pp' }));
    auth = { Authorization: `Bearer ${reg.tokens.accessToken}` };
    await db.insert(schema.personUnlocks).values({ userId: reg.user.id, personId });
    (app.get(ThrottlerStorage) as any).storage.clear();
  });

  afterAll(async () => {
    const db = testApp.db as any;
    // the suppression register is append-only by design: its rows are never deleted; the person row can go (the link is cleared)
    await db.delete(schema.people).where(eq(schema.people.id, personId)).catch(() => undefined);
    const biz = await db.select({ slug: schema.businesses.slug }).from(schema.businesses).where(like(schema.businesses.slug, `${tag}%`));
    await testApp.cleanupBusinesses(biz.map((b: any) => b.slug));
    await testApp.cleanupUsers(emails);
    await testApp.close();
  });

  const download = (id: string) => api().get(`/api/v1/exports/${id}/download`).set(auth).buffer(true).parse(binary);

  it('suppressing a person expires the stored file that contained their contact value', async () => {
    const sch = await api().post('/api/v1/exports/schedules').set(auth).send({ dataset: 'unlocked-people', format: 'csv', frequency: 'DAILY' });
    expect([200, 201]).toContain(sch.status);
    await app.get(ExportService).runDueSchedules(new Date(Date.now() + 3 * 86400000));

    const hist = unwrap(await api().get('/api/v1/exports/history').set(auth));
    const rows = ((Array.isArray(hist) ? hist : (hist.items ?? hist.history ?? [])) as any[]).filter((r) => r.source === 'SCHEDULED' && r.dataset === 'unlocked-people');
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const jobId = rows[0].id as string;
    const before = await download(jobId);
    expect(before.status).toBe(200);
    expect((before.body as Buffer).toString('utf8')).toContain(PERSON_EMAIL); // the premise: the stored file holds the person's e-mail

    await app.get(PeoplePublishingService).suppressPerson(personId, 'Phase 23 removal request test');

    const after = await download(jobId);
    expect(after.status).toBe(410);
    expect((after.body as Buffer).toString('utf8')).not.toContain(PERSON_EMAIL);
    const [row] = await (testApp.db as any).select().from(schema.exportJobs).where(eq(schema.exportJobs.id, jobId));
    expect(row).toMatchObject({ status: 'EXPIRED', content: null });
  });
});
