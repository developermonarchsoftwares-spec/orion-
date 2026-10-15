import supertest from 'supertest';
const request = (supertest as any).default || supertest;
import * as jwt from 'jsonwebtoken';
import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { and, eq, like, or } from 'drizzle-orm';
import { TestAppHelper } from './helpers/test-app.helper';
import { createApprovedSource } from './helpers/approved-source';
import { TEST_SECRETS } from './helpers/test-secrets';
import { MailService, IMail } from '../src/auth/mail/mail.service';
import { ExportService, advanceRun, firstRunAt } from '../src/modules/export/export.service';
import { ExportSchedulerService } from '../src/modules/export/export-scheduler.service';
import * as schema from '../src/database/schema';

const binary = (res: any, cb: (e: Error | null, b?: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('Import & export: bulk CSV, XLSX, scheduling, validation reports, recovery, audit', () => {
  let testApp: TestAppHelper;
  let app: INestApplication;
  const sent: IMail[] = [];
  const api = () => request(app.getHttpServer());
  const unwrap = (res: any) => res.body.data || res.body;
  const emails: string[] = [];
  const adminEmail = 'qa.export.admin@monarchsoftwares.com';
  let admin = { Authorization: '' };
  const tag = `ZZExp${Date.now()}`;
  let srcId = '';

  const newUser = async (name: string) => {
    const email = `export.${name}.${Date.now()}@orion-test.io`;
    emails.push(email);
    const res = unwrap(await api().post('/api/v1/auth/register').send({ email, password: 'ExportPass123!', firstName: 'Ex', lastName: name }));
    return { id: res.user.id as string, email, auth: { Authorization: `Bearer ${res.tokens.accessToken}` } };
  };
  const doExport = (u: { auth: any }, dataset: string, format: string) =>
    api().post('/api/v1/exports').set(u.auth).send({ dataset, format }).buffer(true).parse(binary);
  const audit = async (q = '') => unwrap(await api().get(`/api/v1/exports/admin/audit?${q}`).set(admin));

  beforeAll(async () => {
    testApp = new TestAppHelper();
    app = await testApp.init();
    srcId = await createApprovedSource(testApp.db); // Phase 15: automatic publication needs an approved source
    app.get(MailService).transport = { send: async (m) => void sent.push(m) };
    await testApp.cleanupUsers([adminEmail]);
    const adminId = await testApp.provisionAdmin(adminEmail, 'SUPER_ADMIN');
    admin = { Authorization: `Bearer ${jwt.sign({ sub: adminId, email: adminEmail, role: 'SUPER_ADMIN', status: 'ACTIVE' }, TEST_SECRETS.jwtAccess, { expiresIn: '1h', issuer: 'orion-api', audience: 'orion-client' })}` };
  });

  beforeEach(() => {
    (app.get(ThrottlerStorage) as any).storage.clear();
  });

  afterAll(async () => {
    const biz = await testApp.db.select({ slug: schema.businesses.slug }).from(schema.businesses).where(or(like(schema.businesses.name, `${tag}%`), like(schema.businesses.slug, `%${tag.toLowerCase()}%`)));
    await testApp.cleanupBusinesses(biz.map((b) => b.slug));
    await testApp.db.delete(schema.importBatches).where(like(schema.importBatches.filename, `${tag.toLowerCase()}%`));
    await testApp.cleanupUsers([...emails, adminEmail]);
    await testApp.close();
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('scheduling arithmetic', () => {
    it('first run is the next occurrence of the hour; later runs step from the plan and skip missed ones', () => {
      expect(firstRunAt(6, new Date('2026-10-07T05:00:00Z')).toISOString()).toBe('2026-10-07T06:00:00.000Z');
      expect(firstRunAt(6, new Date('2026-10-07T06:00:00Z')).toISOString()).toBe('2026-10-08T06:00:00.000Z');
      const planned = new Date('2026-10-07T06:00:00Z');
      expect(advanceRun(planned, 'DAILY', new Date('2026-10-07T06:00:05Z')).toISOString()).toBe('2026-10-08T06:00:00.000Z');
      expect(advanceRun(planned, 'WEEKLY', new Date('2026-10-07T06:00:05Z')).toISOString()).toBe('2026-10-14T06:00:00.000Z');
      expect(advanceRun(planned, 'MONTHLY', new Date('2026-10-07T06:00:05Z')).toISOString()).toBe('2026-11-07T06:00:00.000Z');
      // three missed days: one catch-up run, then the next future slot (not three runs)
      expect(advanceRun(planned, 'DAILY', new Date('2026-10-10T07:00:00Z')).toISOString()).toBe('2026-10-11T06:00:00.000Z');
      // day 31 is clamped to 28 so every month has the day
      expect(advanceRun(new Date('2026-01-31T06:00:00Z'), 'MONTHLY', new Date('2026-01-31T07:00:00Z')).toISOString()).toBe('2026-02-28T06:00:00.000Z');
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('on-demand export (CSV and XLSX)', () => {
    it('lists datasets, requires sign-in, and rejects unknown datasets and formats', async () => {
      const u = await newUser('ds');
      const list = unwrap(await api().get('/api/v1/exports/datasets').set(u.auth));
      expect(list.map((d: any) => d.id).sort()).toEqual(['saved-leads', 'unlocked-leads', 'unlocked-people']);
      expect((await api().get('/api/v1/exports/datasets')).status).toBe(401);
      expect((await api().post('/api/v1/exports').set(u.auth).send({ dataset: 'everything', format: 'csv' })).status).toBe(400);
      expect((await api().post('/api/v1/exports').set(u.auth).send({ dataset: 'saved-leads', format: 'pdf' })).status).toBe(400);
      expect((await api().post('/api/v1/exports').send({ dataset: 'saved-leads', format: 'csv' })).status).toBe(401);
    });

    it('exports only the caller\'s unlocked leads (contact details only for unlocked ones), neutralises formulas, as CSV and as XLSX', async () => {
      const u = await newUser('leads');
      const other = await newUser('leads-other');
      const unlocked = await testApp.createTestBusiness({ slug: `${tag.toLowerCase()}-unlocked`, name: `=HYPERLINK("x") ${tag}`, contactEmail: 'alpha.contact@example.com', contactPhone: '+91 9000000001' });
      const locked = await testApp.createTestBusiness({ slug: `${tag.toLowerCase()}-locked`, name: `${tag} Beta Co`, contactEmail: 'beta.contact@example.com', contactPhone: '+91 9000000002' });
      await testApp.db.insert(schema.leadUnlocks).values({ userId: u.id, businessId: unlocked.id });
      await testApp.db.insert(schema.leadUnlocks).values({ userId: other.id, businessId: locked.id });

      const csv = await doExport(u, 'unlocked-leads', 'csv');
      expect(csv.status).toBe(200);
      expect(csv.headers['content-type']).toMatch(/text\/csv/);
      expect(csv.headers['content-disposition']).toMatch(/orion-unlocked-leads-\d{4}-\d{2}-\d{2}\.csv/);
      expect(csv.headers['x-export-row-count']).toBe('1');
      expect(csv.headers['x-export-truncated']).toBe('false');
      const text = (csv.body as Buffer).toString('utf8');
      expect(text.charCodeAt(0)).toBe(0xfeff);
      expect(text).toContain('alpha.contact@example.com');
      expect(text).not.toContain('beta.contact@example.com');
      expect(text).not.toContain('Beta Co');
      expect(text).toContain(`"'=HYPERLINK`); // a leading "=" is prefixed so no spreadsheet runs it

      const xlsx = await doExport(u, 'unlocked-leads', 'xlsx');
      expect(xlsx.status).toBe(200);
      expect(xlsx.headers['content-type']).toMatch(/spreadsheetml\.sheet/);
      const buf = xlsx.body as Buffer;
      expect(buf.subarray(0, 4).toString('hex')).toBe('504b0304'); // a zip container
      expect(buf.length).toBeGreaterThan(500);

      const mine = await api().post('/api/v1/exports').set(other.auth).send({ dataset: 'unlocked-leads', format: 'csv' });
      expect(mine.text).toContain('beta.contact@example.com');
      expect(mine.text).not.toContain('alpha.contact@example.com');
    });

    it('exports saved leads without any contact details', async () => {
      const u = await newUser('saved');
      const b = await testApp.createTestBusiness({ slug: `${tag.toLowerCase()}-saved`, name: `${tag} Saved Co`, contactEmail: 'saved.contact@example.com', contactPhone: '+91 9000000003' });
      await testApp.db.insert(schema.savedLeads).values({ userId: u.id, businessId: b.id, notes: 'call Monday', pipelineStage: 'CONTACTED', tags: ['hot', 'q4'] });
      const r = await api().post('/api/v1/exports').set(u.auth).send({ dataset: 'saved-leads', format: 'csv' });
      expect(r.text).toContain('Saved Co');
      expect(r.text).toContain('CONTACTED');
      expect(r.text).toContain('hot; q4');
      expect(r.text).not.toContain('saved.contact@example.com');
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('export history and audit logs', () => {
    it('every export is in the caller\'s history and in the admin audit trail with who, what, how many rows and from where', async () => {
      const u = await newUser('audit');
      const res = await doExport(u, 'saved-leads', 'xlsx');
      const jobId = res.headers['x-export-id'];

      const hist = unwrap(await api().get('/api/v1/exports/history').set(u.auth));
      expect(hist).toHaveLength(1);
      expect(hist[0]).toMatchObject({ id: jobId, dataset: 'saved-leads', format: 'xlsx', source: 'ON_DEMAND', status: 'COMPLETED', rowCount: 0, downloadable: false });
      expect(hist[0].content).toBeUndefined();

      const trail = await audit(`userId=${u.id}`);
      expect(trail.total).toBe(1);
      expect(trail.items[0]).toMatchObject({ action: 'EXPORT_CREATED', userEmail: u.email, entityId: jobId });
      expect(trail.items[0].details).toMatchObject({ dataset: 'saved-leads', format: 'xlsx', rowCount: 0, source: 'ON_DEMAND' });
      expect(trail.items[0].ipAddress).toBeTruthy();
    });

    it('the audit trail is admin-only, filterable, and holds no file content', async () => {
      const u = await newUser('audit2');
      await doExport(u, 'saved-leads', 'csv');
      expect((await api().get('/api/v1/exports/admin/audit').set(u.auth)).status).toBe(403);
      expect((await api().get('/api/v1/exports/admin/audit')).status).toBe(401);
      expect((await api().get('/api/v1/exports/admin/audit?limit=0').set(admin)).status).toBe(400);
      const onlyCreated = await audit('action=EXPORT_CREATED&limit=200');
      expect(onlyCreated.items.every((i: any) => i.action === 'EXPORT_CREATED')).toBe(true);
      expect(onlyCreated.items.length).toBeGreaterThan(0);
      const future = await audit(`from=${new Date(Date.now() + 86_400_000).toISOString()}`);
      expect(future.total).toBe(0);
      const all = await audit('limit=200');
      expect(all.items.every((i: any) => String(i.action).startsWith('EXPORT_'))).toBe(true);
      expect(JSON.stringify(all)).not.toMatch(/alpha\.contact@example\.com|BEGIN|PK\u0003/);
    });

    it('the existing people CSV export is audited too', async () => {
      const u = await newUser('people');
      const r = await api().post('/api/v1/people/export').set(u.auth).send({});
      expect(r.status).toBe(200);
      const trail = await audit(`userId=${u.id}&action=EXPORT_CREATED`);
      expect(trail.items[0].details).toMatchObject({ dataset: 'unlocked-people', format: 'csv', source: 'ON_DEMAND' });
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('scheduled exports', () => {
    it('creates, lists, validates, updates, deletes, and keeps schedules private', async () => {
      const u = await newUser('sched');
      const other = await newUser('sched-other');
      const c = await api().post('/api/v1/exports/schedules').set(u.auth).send({ dataset: 'saved-leads', format: 'xlsx', frequency: 'WEEKLY', hourUtc: 9 });
      expect(c.status).toBe(201);
      const s = unwrap(c);
      expect(s).toMatchObject({ dataset: 'saved-leads', format: 'xlsx', frequency: 'WEEKLY', hourUtc: 9, enabled: true });
      expect(new Date(s.nextRunAt).getUTCHours()).toBe(9);
      expect(new Date(s.nextRunAt).getTime()).toBeGreaterThan(Date.now());

      for (const bad of [{ hourUtc: 24 }, { hourUtc: -1 }, { frequency: 'HOURLY' }, { format: 'pdf' }, { dataset: 'nope' }]) {
        const r = await api().post('/api/v1/exports/schedules').set(u.auth).send({ dataset: 'saved-leads', format: 'csv', frequency: 'DAILY', ...bad });
        expect(r.status).toBe(400);
      }
      expect(unwrap(await api().get('/api/v1/exports/schedules').set(u.auth))).toHaveLength(1);
      expect(unwrap(await api().get('/api/v1/exports/schedules').set(other.auth))).toHaveLength(0);
      expect((await api().patch(`/api/v1/exports/schedules/${s.id}`).set(other.auth).send({ enabled: false })).status).toBe(404);
      expect((await api().delete(`/api/v1/exports/schedules/${s.id}`).set(other.auth)).status).toBe(404);

      const upd = await api().patch(`/api/v1/exports/schedules/${s.id}`).set(u.auth).send({ enabled: false });
      expect(unwrap(upd).enabled).toBe(false);
      expect((await api().delete(`/api/v1/exports/schedules/${s.id}`).set(u.auth)).status).toBe(200);
      expect(unwrap(await api().get('/api/v1/exports/schedules').set(u.auth))).toHaveLength(0);

      const actions = (await audit(`userId=${u.id}&limit=50`)).items.map((i: any) => i.action);
      expect(actions).toEqual(expect.arrayContaining(['EXPORT_SCHEDULE_CREATED', 'EXPORT_SCHEDULE_UPDATED', 'EXPORT_SCHEDULE_DELETED']));
    });

    it('limits a user to 10 schedules', async () => {
      const u = await newUser('limit');
      for (let i = 0; i < 10; i++) expect((await api().post('/api/v1/exports/schedules').set(u.auth).send({ dataset: 'saved-leads', format: 'csv', frequency: 'DAILY' })).status).toBe(201);
      expect((await api().post('/api/v1/exports/schedules').set(u.auth).send({ dataset: 'saved-leads', format: 'csv', frequency: 'DAILY' })).status).toBe(409);
    });

    it('the scheduler runs a due schedule once, stores the file for its owner, advances the next run, and expires the file', async () => {
      const u = await newUser('run');
      const other = await newUser('run-other');
      const s = unwrap(await api().post('/api/v1/exports/schedules').set(u.auth).send({ dataset: 'saved-leads', format: 'xlsx', frequency: 'DAILY', hourUtc: 6 }));
      const past = new Date(Date.now() - 3 * 86_400_000);
      await testApp.db.update(schema.exportSchedules).set({ nextRunAt: past }).where(eq(schema.exportSchedules.id, s.id));

      sent.length = 0;
      const scheduler = app.get(ExportSchedulerService);
      expect(await scheduler.tick()).toMatchObject({ ran: 1, failed: 0 });
      expect(await scheduler.tick()).toMatchObject({ ran: 0 }); // already claimed: no second run

      const [after] = await testApp.db.select().from(schema.exportSchedules).where(eq(schema.exportSchedules.id, s.id));
      expect(after.lastStatus).toBe('COMPLETED');
      expect(after.nextRunAt.getTime()).toBeGreaterThan(Date.now()); // three missed days -> one run, not three
      expect(after.nextRunAt.getTime() - Date.now()).toBeLessThanOrEqual(86_400_000);
      expect(sent.some((m) => m.to === u.email && m.subject === 'Your scheduled export is ready')).toBe(true);

      const hist = unwrap(await api().get('/api/v1/exports/history').set(u.auth));
      expect(hist).toHaveLength(1);
      expect(hist[0]).toMatchObject({ source: 'SCHEDULED', scheduleId: s.id, status: 'COMPLETED', downloadable: true });

      const dl = await api().get(`/api/v1/exports/${hist[0].id}/download`).set(u.auth).buffer(true).parse(binary);
      expect(dl.status).toBe(200);
      expect((dl.body as Buffer).subarray(0, 4).toString('hex')).toBe('504b0304');
      expect((await api().get(`/api/v1/exports/${hist[0].id}/download`).set(other.auth)).status).toBe(404); // not the owner
      expect((await api().get(`/api/v1/exports/${hist[0].id}/download`)).status).toBe(401);
      expect(unwrap(await api().get('/api/v1/exports/history').set(u.auth))[0].downloadCount).toBe(1);
      expect((await audit(`userId=${u.id}&action=EXPORT_DOWNLOADED`)).total).toBe(1);

      await testApp.db.update(schema.exportJobs).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.exportJobs.id, hist[0].id));
      expect((await scheduler.tick()).purged).toBe(1);
      expect((await api().get(`/api/v1/exports/${hist[0].id}/download`).set(u.auth)).status).toBe(410);
      expect(unwrap(await api().get('/api/v1/exports/history').set(u.auth))[0]).toMatchObject({ status: 'EXPIRED', downloadable: false });
    });

    it('three failed runs in a row switch the schedule off, record each failure, and tell the owner', async () => {
      const u = await newUser('fail');
      const s = unwrap(await api().post('/api/v1/exports/schedules').set(u.auth).send({ dataset: 'saved-leads', format: 'csv', frequency: 'DAILY' }));
      const svc = app.get(ExportService) as any;
      const spy = jest.spyOn(svc, 'savedLeads').mockRejectedValue(new Error('boom'));
      try {
        sent.length = 0;
        const scheduler = app.get(ExportSchedulerService);
        for (let i = 0; i < 3; i++) {
          await testApp.db.update(schema.exportSchedules).set({ nextRunAt: new Date(Date.now() - 1000) }).where(eq(schema.exportSchedules.id, s.id));
          expect(await scheduler.tick()).toMatchObject({ failed: 1 });
        }
      } finally {
        spy.mockRestore();
      }
      const [row] = await testApp.db.select().from(schema.exportSchedules).where(eq(schema.exportSchedules.id, s.id));
      expect(row).toMatchObject({ enabled: false, lastStatus: 'FAILED', consecutiveFailures: 3 });
      const hist = unwrap(await api().get('/api/v1/exports/history').set(u.auth));
      expect(hist.filter((h: any) => h.status === 'FAILED')).toHaveLength(3);
      expect(hist[0].error).toBe('boom');
      expect(sent.some((m) => m.to === u.email && m.subject === 'A scheduled export was switched off')).toBe(true);
      const actions = (await audit(`userId=${u.id}&limit=50`)).items.map((i: any) => i.action);
      expect(actions).toEqual(expect.arrayContaining(['EXPORT_FAILED', 'EXPORT_SCHEDULE_DISABLED']));

      // switching it back on is a fresh start
      const on = unwrap(await api().patch(`/api/v1/exports/schedules/${s.id}`).set(u.auth).send({ enabled: true }));
      expect(on).toMatchObject({ enabled: true, consecutiveFailures: 0 });
    });

    it('does not run schedules of a suspended user', async () => {
      const u = await newUser('susp');
      const s = unwrap(await api().post('/api/v1/exports/schedules').set(u.auth).send({ dataset: 'saved-leads', format: 'csv', frequency: 'DAILY' }));
      await testApp.db.update(schema.users).set({ status: 'SUSPENDED' }).where(eq(schema.users.id, u.id));
      await testApp.db.update(schema.exportSchedules).set({ nextRunAt: new Date(Date.now() - 1000) }).where(eq(schema.exportSchedules.id, s.id));
      expect(await app.get(ExportSchedulerService).tick()).toMatchObject({ ran: 0 });
      const [row] = await testApp.db.select().from(schema.exportSchedules).where(eq(schema.exportSchedules.id, s.id));
      expect(row.enabled).toBe(false);
      expect(unwrap(await api().get('/api/v1/exports/history').set({ Authorization: u.auth.Authorization }))).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('bulk CSV import, validation report and failed-import recovery', () => {
    const places: Record<string, [string, string]> = { A: ['Pune', 'Maharashtra'], B: ['Chennai', 'Tamil Nadu'], C: ['Kochi', 'Kerala'], D: ['Jaipur', 'Rajasthan'], E: ['Lucknow', 'Uttar Pradesh'] };
    const phone = (n: string) => `+91 20 2555 ${String(n.charCodeAt(0) * 7).padStart(4, '0')}`;
    const goodRow = (n: string) => `${tag} ${n},${n}-${n.charCodeAt(0)} Park Street,${places[n][0]},${places[n][1]},411001,${phone(n)},hello@${tag.toLowerCase()}${n}.in`;
    const badRow = (n: string) => `${tag} ${n},${n}-${n.charCodeAt(0)} Park Street,${places[n][0]},,12,${phone(n)},hello@${tag.toLowerCase()}${n}.in`; // no state, bad pincode
    const header = 'business_name,address_line1,city,state,pincode,phone,email';
    const csvOf = (...rows: string[]) => `${header}\n${rows.join('\n')}\n`;
    const filename = `${tag.toLowerCase()}.csv`;

    it('refuses the CSV routes to non-admins, and an unusable file with a readable report', async () => {
      const u = await newUser('imp-user');
      expect((await api().post('/api/v1/admin/import/csv/preview').set(u.auth).send({ csv: csvOf(goodRow('A')) })).status).toBe(403);
      expect((await api().post('/api/v1/admin/import/csv/submit').send({ csv: csvOf(goodRow('A')) })).status).toBe(401);
      const unterminated = await api().post('/api/v1/admin/import/csv/preview').set(admin).send({ csv: `${header}\n"open,1,2\n` });
      expect(unterminated.status).toBe(400);
      expect(JSON.stringify(unterminated.body)).toContain('INVALID_CSV');
      expect(JSON.stringify(unterminated.body)).toContain('UNTERMINATED_QUOTE');
      expect((await api().post('/api/v1/admin/import/csv/preview').set(admin).send({ csv: '' })).status).toBe(400);
      expect((await api().post('/api/v1/admin/import/csv/preview').set(admin).send({ csv: 123 })).status).toBe(400);
    });

    it('previews a CSV with a parse report, then imports it: good rows publish, bad rows fail with reasons, nothing is lost', async () => {
      const prev = await api().post('/api/v1/admin/import/csv/preview').set(admin).send({ csv: csvOf(goodRow('A'), badRow('B')) });
      expect(prev.status).toBe(200);
      expect(unwrap(prev).parse).toMatchObject({ rowCount: 2, delimiter: ',' });

      const res = await api().post('/api/v1/admin/import/csv/submit').set(admin).send({ sourceId: srcId, autoPublish: true, filename, csv: csvOf(goodRow('A'), badRow('B')) });
      expect(res.status).toBe(201);
      const out = unwrap(res);
      expect(out).toMatchObject({ totalRecords: 2, publishedCount: 1, failedCount: 1 });
      expect(out.report).toContain(`/batches/${out.batchId}/report`);
      expect(out.failedRowsCsv).toContain('/failed.csv');
      expect(out.parse.issues).toEqual([]);
      (global as any).__batchId = out.batchId;
    });

    it('the validation report lists the failed row with its rule, field and message, and totals by rule', async () => {
      const id = (global as any).__batchId as string;
      const rep = unwrap(await api().get(`/api/v1/admin/import/operations/batches/${id}/report`).set(admin));
      expect(rep.batch).toMatchObject({ totalRecords: 2, successfulRecords: 1, failedRecords: 1 });
      expect(rep.recordStatus).toMatchObject({ FAILED: 1, PUBLISHED: 1 });
      expect(rep.recoverable).toBe(1);
      expect(rep.rows).toHaveLength(1);
      expect(rep.rows[0]).toMatchObject({ rowNumber: 2, status: 'FAILED' });
      expect(rep.rows[0].company).toContain('B');
      const fields = rep.rows[0].issues.map((i: any) => i.field);
      expect(fields.length).toBeGreaterThan(0);
      expect(rep.byRule.length).toBeGreaterThan(0);
      expect(rep.byRule[0]).toEqual(expect.objectContaining({ rule: expect.any(String), severity: expect.any(String), count: expect.any(Number) }));

      const csv = await api().get(`/api/v1/admin/import/operations/batches/${id}/report.csv`).set(admin);
      expect(csv.status).toBe(200);
      expect(csv.headers['content-type']).toMatch(/text\/csv/);
      expect(csv.text).toContain('"Row","Status","Company","Rule","Field","Severity","Message"');
      expect(csv.text).toContain('FAILED');

      const u = await newUser('rep-user');
      expect((await api().get(`/api/v1/admin/import/operations/batches/${id}/report`).set(u.auth)).status).toBe(403);
      expect((await api().get('/api/v1/admin/import/operations/batches/not-a-uuid/report').set(admin)).status).toBe(400);
      expect((await api().get('/api/v1/admin/import/operations/batches/00000000-0000-0000-0000-000000000000/report').set(admin)).status).toBe(404);
    });

    it('the failed-rows CSV carries the reasons, and uploading it again treats the `_` columns as bookkeeping, not data', async () => {
      const id = (global as any).__batchId as string;
      const dl = await api().get(`/api/v1/admin/import/operations/batches/${id}/failed.csv`).set(admin);
      expect(dl.status).toBe(200);
      expect(dl.headers['x-export-row-count']).toBe('1');
      const lines = dl.text.replace(/^﻿/, '').split('\n');
      expect(lines[0]).toContain('_row_number');
      expect(lines[0]).toContain('_errors');
      expect(lines[0]).not.toMatch(/businessName|addressLine1/); // no camelCase alias duplicates
      expect(dl.text).toContain(`${tag} B`);
      expect(dl.text).toMatch(/state|pincode/i);

      const again = await api().post('/api/v1/admin/import/csv/submit').set(admin).send({ sourceId: srcId, autoPublish: true, filename: `${tag.toLowerCase()}-again.csv`, csv: dl.text });
      expect(again.status).toBe(201);
      expect(unwrap(again).parse.headers.some((h: string) => h.startsWith('_'))).toBe(false);
      const recs = await testApp.db.select().from(schema.importRecords).where(eq(schema.importRecords.batchId, unwrap(again).batchId));
      expect(recs).toHaveLength(1);
      expect(Object.keys(recs[0].rawPayload as object).some((k) => k.startsWith('_'))).toBe(false);

      // the download was audited as an export
      const trail = await audit('action=EXPORT_CREATED&limit=200');
      expect(trail.items.some((i: any) => i.details?.dataset === 'import-failed-rows' && i.details?.batchId === id && i.details?.rowCount === 1)).toBe(true);
    });

    it('corrects one failed row and re-runs it: it publishes, and the batch counters follow', async () => {
      const res = await api().post('/api/v1/admin/import/csv/submit').set(admin).send({ sourceId: srcId, autoPublish: true, filename: `${tag.toLowerCase()}-fix.csv`, csv: csvOf(badRow('C')) });
      const out = unwrap(res);
      expect(out).toMatchObject({ failedCount: 1 });
      const [rec] = await testApp.db.select().from(schema.importRecords).where(eq(schema.importRecords.batchId, out.batchId));
      expect(rec.status).toBe('FAILED');

      const before = await testApp.db.select().from(schema.validationLogs).where(eq(schema.validationLogs.recordId, rec.id));
      expect(before.some((l) => !l.passed)).toBe(true);

      const bad = await api().patch(`/api/v1/admin/import/operations/records/${rec.id}`).set(admin).send({ fields: { __proto__x: 'ok', 'bad key!': 'x' } });
      expect(bad.status).toBe(400);
      expect((await api().patch(`/api/v1/admin/import/operations/records/${rec.id}`).set(admin).send({ fields: {} })).status).toBe(400);

      const fixed = await api().patch(`/api/v1/admin/import/operations/records/${rec.id}`).set(admin).send({ fields: { state: 'Kerala', pincode: '682001' } });
      expect(fixed.status).toBe(200);
      expect(unwrap(fixed)).toMatchObject({ rowNumber: 1, status: 'PUBLISHED', batch: { total: 1, published: 1, failed: 0 } });
      const [batch] = await testApp.db.select().from(schema.importBatches).where(eq(schema.importBatches.id, out.batchId));
      expect(batch).toMatchObject({ status: 'COMPLETED', successfulRecords: 1, failedRecords: 0 });
      const after = await testApp.db.select().from(schema.validationLogs).where(eq(schema.validationLogs.recordId, rec.id));
      expect(after.filter((l) => !l.passed)).toHaveLength(0); // earlier failures were cleared, not stacked

      // a published row cannot be "corrected"
      expect((await api().patch(`/api/v1/admin/import/operations/records/${rec.id}`).set(admin).send({ fields: { city: 'X' } })).status).toBe(409);
      const u = await newUser('corr-user');
      expect((await api().patch(`/api/v1/admin/import/operations/records/${rec.id}`).set(u.auth).send({ fields: { city: 'X' } })).status).toBe(403);

      const audits = await audit('limit=200');
      expect(audits.items.length).toBeGreaterThan(0);
      const dbAudit = await testApp.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, 'IMPORT_RECORD_CORRECTED'));
      const mine = dbAudit.find((a) => a.entityId === rec.id)!;
      expect(mine.newValues).toMatchObject({ fields: ['state', 'pincode'], resultStatus: 'PUBLISHED' });
      expect(JSON.stringify(mine.newValues)).not.toContain('682001'); // names only, never values
    });

    it('retry-failed re-runs every failed row; rows still invalid stay failed, rows fixed elsewhere recover; a busy batch is refused', async () => {
      const res = await api().post('/api/v1/admin/import/csv/submit').set(admin).send({ sourceId: srcId, autoPublish: true, filename: `${tag.toLowerCase()}-retry.csv`, csv: csvOf(badRow('D'), badRow('E')) });
      const out = unwrap(res);
      expect(out).toMatchObject({ failedCount: 2 });

      const none = unwrap(await api().post(`/api/v1/admin/import/operations/batches/${out.batchId}/retry-failed`).set(admin));
      expect(none).toMatchObject({ attempted: 2, recovered: 0, stillFailed: 2 });

      // row D is repaired out of band (for example a reference-data fix), row E is not
      const recs = await testApp.db.select().from(schema.importRecords).where(eq(schema.importRecords.batchId, out.batchId));
      const d = recs.find((r) => r.rowNumber === 1)!;
      await testApp.db.update(schema.importRecords).set({ rawPayload: { ...(d.rawPayload as object), state: 'Rajasthan', pincode: '302001' } }).where(eq(schema.importRecords.id, d.id));
      const some = unwrap(await api().post(`/api/v1/admin/import/operations/batches/${out.batchId}/retry-failed`).set(admin));
      expect(some).toMatchObject({ attempted: 2, recovered: 1, stillFailed: 1 });
      const [batch] = await testApp.db.select().from(schema.importBatches).where(eq(schema.importBatches.id, out.batchId));
      expect(batch).toMatchObject({ successfulRecords: 1, failedRecords: 1, status: 'COMPLETED' });

      await testApp.db.update(schema.importBatches).set({ status: 'PROCESSING', updatedAt: new Date() }).where(eq(schema.importBatches.id, out.batchId));
      const busy = await api().post(`/api/v1/admin/import/operations/batches/${out.batchId}/retry-failed`).set(admin);
      expect(busy.status).toBe(409);
      // a run that crashed long ago can be taken over
      await testApp.db.update(schema.importBatches).set({ updatedAt: new Date(Date.now() - 3_600_000) }).where(eq(schema.importBatches.id, out.batchId));
      expect((await api().post(`/api/v1/admin/import/operations/batches/${out.batchId}/retry-failed`).set(admin)).status).toBe(200);

      const u = await newUser('retry-user');
      expect((await api().post(`/api/v1/admin/import/operations/batches/${out.batchId}/retry-failed`).set(u.auth)).status).toBe(403);
    });

    it('a run that died part-way (unreached rows stay PENDING, batch stays PROCESSING) is finished by retry-failed once stale; PENDING rows of a finished batch are left alone (Phase 29)', async () => {
      const mkBatch = async (status: 'PROCESSING' | 'COMPLETED', updatedAt: Date) => {
        const [b] = await testApp.db.insert(schema.importBatches).values({ filename: `${tag.toLowerCase()}-crash.csv`, fileKey: `inline/${tag.toLowerCase()}-crash`, fileSize: 1, status, totalRecords: 2, sourceId: srcId, updatedAt } as any).returning();
        const rows = ['P', 'Q'].map((n, i) => ({ batchId: b.id, rowNumber: i + 1, status: 'PENDING' as const, rawPayload: { business_name: `${tag} ${n}`, address_line1: `${n}-1 Park Street`, city: 'Pune', state: 'Maharashtra', pincode: '411001', phone: `+91 98${String(30000000 + i)}`, email: `hello@${tag.toLowerCase()}${n.toLowerCase()}.in` } }));
        await testApp.db.insert(schema.importRecords).values(rows as any);
        return b.id as string;
      };
      const pending = async (id: string) => (await testApp.db.select().from(schema.importRecords).where(eq(schema.importRecords.batchId, id))).filter((r) => r.status === 'PENDING').length;

      // a finished batch with a PENDING row is not "crashed": nothing is run
      const done = await mkBatch('COMPLETED', new Date(Date.now() - 3_600_000));
      const none = unwrap(await api().post(`/api/v1/admin/import/operations/batches/${done}/retry-failed`).set(admin));
      expect(none.attempted).toBe(0);
      expect(await pending(done)).toBe(2);

      // a batch that is still being worked on (recent) is refused
      const live = await mkBatch('PROCESSING', new Date());
      expect((await api().post(`/api/v1/admin/import/operations/batches/${live}/retry-failed`).set(admin)).status).toBe(409);
      expect(await pending(live)).toBe(2);

      // a batch whose run died: the unreached rows are run, and the batch is no longer PROCESSING
      const dead = await mkBatch('PROCESSING', new Date(Date.now() - 3_600_000));
      // one row was part-way through when the process died
      await testApp.db.update(schema.importRecords).set({ status: 'NORMALIZED' }).where(and(eq(schema.importRecords.batchId, dead), eq(schema.importRecords.rowNumber, 1)));
      const resumed = unwrap(await api().post(`/api/v1/admin/import/operations/batches/${dead}/retry-failed`).set(admin));
      expect(resumed.attempted).toBe(2);
      expect((await testApp.db.select().from(schema.importRecords).where(eq(schema.importRecords.batchId, dead))).filter((r) => ['PENDING', 'NORMALIZED', 'VALIDATED'].includes(r.status)).length).toBe(0);
      const [after] = await testApp.db.select().from(schema.importBatches).where(eq(schema.importBatches.id, dead));
      expect(after.status).not.toBe('PROCESSING');
    });

    it('a dead run with more unreached rows than one call may run stays resumable until every row has been reached (Phase 29)', async () => {
      const [b] = await testApp.db.insert(schema.importBatches).values({ filename: `${tag.toLowerCase()}-big.csv`, fileKey: `inline/${tag.toLowerCase()}-big`, fileSize: 1, status: 'PROCESSING', totalRecords: 1002, sourceId: srcId, updatedAt: new Date(Date.now() - 3_600_000) } as any).returning();
      const payload = (i: number) => ({ business_name: `${tag} Big ${i}`, address_line1: `${i} Big Road`, city: 'Pune', state: 'Maharashtra', pincode: '411001', phone: `+91 97${String(10000000 + i)}`, email: `big${i}@${tag.toLowerCase()}.in` });
      await testApp.db.insert(schema.importRecords).values(Array.from({ length: 1002 }, (_, i) => ({ batchId: b.id, rowNumber: i + 1, status: 'PENDING' as const, rawPayload: payload(i) })) as any);
      const url = `/api/v1/admin/import/operations/batches/${b.id}/retry-failed`;
      const first = unwrap(await api().post(url).set(admin));
      expect(first).toMatchObject({ attempted: 1000, moreRemaining: true });
      const [mid] = await testApp.db.select().from(schema.importBatches).where(eq(schema.importBatches.id, b.id));
      expect(mid.status).toBe('PROCESSING'); // not marked finished while 2 rows were never reached
      const second = unwrap(await api().post(url).set(admin));
      expect(second).toMatchObject({ attempted: 2, moreRemaining: false });
      const [end] = await testApp.db.select().from(schema.importBatches).where(eq(schema.importBatches.id, b.id));
      expect(end.status).not.toBe('PROCESSING');
    }, 120_000);
  });
});
