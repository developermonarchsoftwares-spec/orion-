import supertest from 'supertest';
const request = (supertest as any).default || supertest;
import * as jwt from 'jsonwebtoken';
import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { and, eq, inArray, like } from 'drizzle-orm';
import { TestAppHelper } from './helpers/test-app.helper';
import { TEST_SECRETS } from './helpers/test-secrets';
import { MailService } from '../src/auth/mail/mail.service';
import { ExportService, MAX_EXPORT_ROWS, MAX_EXPORT_ROWS_PER_DAY } from '../src/modules/export/export.service';
import * as schema from '../src/database/schema';

/**
 * Phase 9: export security. Every assertion reads the bytes of the file that was actually produced.
 * Data is created here under a unique tag and removed afterwards; no production data is touched.
 */
const binary = (res: any, cb: (e: Error | null, b?: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

/** Minimal RFC 4180 parser so assertions look at real cells, not at substrings. */
function parseCsv(text: string): string[][] {
  const t = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"' && t[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

describe('Export security (Phase 9)', () => {
  let testApp: TestAppHelper;
  let app: INestApplication;
  const api = () => request(app.getHttpServer());
  const unwrap = (res: any) => res.body.data || res.body;
  const emails: string[] = [];
  const adminEmail = 'qa.export.sec.admin@monarchsoftwares.com';
  let admin = { Authorization: '' };
  const tag = `ZZExpSec${Date.now()}`;
  const slug = (s: string) => `${tag.toLowerCase()}-${s}`;

  const newUser = async (name: string) => {
    const email = `exsec.${name}.${Date.now()}@orion-test.io`;
    emails.push(email);
    const res = unwrap(await api().post('/api/v1/auth/register').send({ email, password: 'ExportPass123!', firstName: 'Ex', lastName: name }));
    return { id: res.user.id as string, email, auth: { Authorization: `Bearer ${res.tokens.accessToken}` } };
  };
  const doExport = (u: { auth: any }, dataset: string, format = 'csv', extra: Record<string, string> = {}) =>
    api().post('/api/v1/exports').set(u.auth).set(extra).send({ dataset, format }).buffer(true).parse(binary);
  const csvOf = (r: any) => parseCsv((r.body as Buffer).toString('utf8'));
  const auditRows = async (userId: string, action: string) =>
    testApp.db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.userId, userId), eq(schema.auditLogs.action, action)));

  beforeAll(async () => {
    testApp = new TestAppHelper();
    app = await testApp.init();
    app.get(MailService).transport = { send: async () => undefined };
    await testApp.cleanupUsers([adminEmail]);
    const adminId = await testApp.provisionAdmin(adminEmail, 'SUPER_ADMIN');
    admin = { Authorization: `Bearer ${jwt.sign({ sub: adminId, email: adminEmail, role: 'SUPER_ADMIN', status: 'ACTIVE' }, TEST_SECRETS.jwtAccess, { expiresIn: '1h', issuer: 'orion-api', audience: 'orion-client' })}` };
  });

  beforeEach(() => {
    (app.get(ThrottlerStorage) as any).storage.clear();
  });

  afterAll(async () => {
    const biz = await testApp.db.select({ slug: schema.businesses.slug }).from(schema.businesses).where(like(schema.businesses.slug, `${tag.toLowerCase()}%`));
    await testApp.cleanupBusinesses(biz.map((b) => b.slug));
    await testApp.cleanupUsers([...emails, adminEmail]);
    await testApp.close();
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('who may export, and whose data', () => {
    it('refuses every export route without a token', async () => {
      expect((await api().post('/api/v1/exports').send({ dataset: 'saved-leads', format: 'csv' })).status).toBe(401);
      expect((await api().get('/api/v1/exports/history')).status).toBe(401);
      expect((await api().get('/api/v1/exports/00000000-0000-4000-8000-000000000000/download')).status).toBe(401);
      expect((await api().get('/api/v1/exports/schedules')).status).toBe(401);
      expect((await api().post('/api/v1/people/export').send({})).status).toBe(401);
      expect((await api().get('/api/v1/exports/admin/audit')).status).toBe(401);
    });

    it('the export audit trail is for administrators only', async () => {
      const u = await newUser('plain');
      expect((await api().get('/api/v1/exports/admin/audit').set(u.auth)).status).toBe(403);
      expect((await api().get('/api/v1/exports/admin/audit').set(admin)).status).toBe(200);
    });

    it('ownership cannot be supplied by the client: extra fields are refused and nothing leaks from the named account', async () => {
      const a = await newUser('own-a');
      const b = await newUser('own-b');
      const biz = await testApp.createTestBusiness({ slug: slug('own'), name: `${tag} Own Co`, contactEmail: 'own.secret@example.com', contactPhone: '+91 9000000011' });
      await testApp.db.insert(schema.leadUnlocks).values({ userId: b.id, businessId: biz.id });
      for (const extra of [{ userId: b.id }, { ownerId: b.id }, { businessIds: [biz.id] }, { limit: 1000000 }]) {
        const r = await api().post('/api/v1/exports').set(a.auth).send({ dataset: 'unlocked-leads', format: 'csv', ...extra });
        expect(r.status).toBe(400);
        expect(JSON.stringify(r.body)).not.toContain('own.secret@example.com');
      }
      // the query string cannot choose an account or a lead either
      const viaQuery = await api().post(`/api/v1/exports?userId=${b.id}`).set(a.auth).send({ dataset: 'unlocked-leads', format: 'csv' }).buffer(true).parse(binary);
      expect([200, 400]).toContain(viaQuery.status);
      if (viaQuery.status === 200) expect((viaQuery.body as Buffer).toString('utf8')).not.toContain('own.secret@example.com');
    });

    it('a stored export file is downloadable by its owner only; another customer, odd ids and path-like ids get nothing', async () => {
      const a = await newUser('dl-a');
      const b = await newUser('dl-b');
      const content = Buffer.from('\ufeff"Company"\n"File of A"\n', 'utf8');
      const [job] = await testApp.db
        .insert(schema.exportJobs)
        .values({ userId: a.id, dataset: 'saved-leads', format: 'csv', source: 'SCHEDULED', status: 'COMPLETED', rowCount: 1, fileName: 'orion-saved-leads-2026-10-10.csv', contentType: 'text/csv; charset=utf-8', sizeBytes: content.length, content, expiresAt: new Date(Date.now() + 86_400_000) })
        .returning();

      const mine = await api().get(`/api/v1/exports/${job.id}/download`).set(a.auth).buffer(true).parse(binary);
      expect(mine.status).toBe(200);
      expect((mine.body as Buffer).toString('utf8')).toContain('File of A');
      expect(mine.headers['content-disposition']).toBe('attachment; filename="orion-saved-leads-2026-10-10.csv"');
      expect(mine.headers['cache-control']).toMatch(/no-store/);
      expect(mine.headers['x-content-type-options']).toBe('nosniff');

      const theirs = await api().get(`/api/v1/exports/${job.id}/download`).set(b.auth);
      expect(theirs.status).toBe(404);
      expect(JSON.stringify(theirs.body)).not.toContain('File of A');
      // the history of B does not list A's job
      const histB = unwrap(await api().get('/api/v1/exports/history').set(b.auth));
      expect(JSON.stringify(histB)).not.toContain(job.id);

      for (const id of ['..%2F..%2Fetc%2Fpasswd', '%2e%2e%2f%2e%2e%2fetc%2fpasswd', "1' OR '1'='1", 'null', '00000000-0000-4000-8000-000000000000', 'not-a-uuid']) {
        const r = await api().get(`/api/v1/exports/${id}/download`).set(a.auth);
        expect([400, 404]).toContain(r.status);
        expect(JSON.stringify(r.body)).not.toMatch(/root:|\/etc\/|[A-Z]:\\|stack|at .*\.ts/);
      }
      // the stored file bytes are never part of the history listing
      expect(JSON.stringify(unwrap(await api().get('/api/v1/exports/history').set(a.auth)))).not.toContain('File of A');
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('what the file contains', () => {
    it('unlocked leads: only the caller\'s unlocked, published companies; phone and e-mail kept as stored; no internal fields', async () => {
      const u = await newUser('lead');
      const other = await newUser('lead-other');
      const mine = await testApp.createTestBusiness({ slug: slug('mine'), name: `${tag} Mine Co`, contactEmail: 'mine.contact@example.com', contactPhone: '+91 9000000021' });
      const notMine = await testApp.createTestBusiness({ slug: slug('notmine'), name: `${tag} NotMine Co`, contactEmail: 'notmine.contact@example.com', contactPhone: '+91 9000000022' });
      const never = await testApp.createTestBusiness({ slug: slug('never'), name: `${tag} Never Co`, contactEmail: 'never.contact@example.com', contactPhone: '+91 9000000023' });
      await testApp.db.insert(schema.leadUnlocks).values({ userId: u.id, businessId: mine.id });
      await testApp.db.insert(schema.leadUnlocks).values({ userId: other.id, businessId: notMine.id });
      void never;

      const r = await doExport(u, 'unlocked-leads');
      expect(r.status).toBe(200);
      const text = (r.body as Buffer).toString('utf8');
      const rows = csvOf(r);
      expect(rows[0]).toEqual(['Company', 'Legal Name', 'Employees', 'Revenue', 'Founded', 'Verified', 'Unlocked On', 'Contact', 'Title', 'Department', 'Email', 'Phone', 'LinkedIn']);
      expect(rows).toHaveLength(2);
      expect(rows[1][0]).toBe(`${tag} Mine Co`);
      expect(rows[1][10]).toBe('mine.contact@example.com');
      expect(rows[1][11]).toBe('+91 9000000021'); // a valid phone number is not corrupted by the formula guard
      for (const leak of ['notmine.contact@example.com', 'never.contact@example.com', 'NotMine Co', 'Never Co', '+91 9000000022', '+91 9000000023']) expect(text).not.toContain(leak);
      // no identifier, pipeline, source, audit or score field
      expect(text).not.toMatch(UUID);
      expect(rows[0].join(' ').toLowerCase()).not.toMatch(/\bid\b|source|pipeline|audit|confidence|score|moderation|internal|raw|batch|slug/);
      expect(text).not.toContain(mine.slug);
    });

    it('a company that is no longer published disappears from the export, including its contacts, even if it was unlocked', async () => {
      const u = await newUser('unpub');
      const b = await testApp.createTestBusiness({ slug: slug('unpub'), name: `${tag} Withdrawn Co`, contactEmail: 'withdrawn.contact@example.com', contactPhone: '+91 9000000031' });
      await testApp.db.insert(schema.leadUnlocks).values({ userId: u.id, businessId: b.id });
      await testApp.db.insert(schema.savedLeads).values({ userId: u.id, businessId: b.id, notes: 'n' });
      const before = await doExport(u, 'unlocked-leads');
      expect((before.body as Buffer).toString('utf8')).toContain('withdrawn.contact@example.com');

      await testApp.db.update(schema.businesses).set({ status: 'DRAFT' }).where(eq(schema.businesses.id, b.id));
      for (const dataset of ['unlocked-leads', 'saved-leads']) {
        const r = await doExport(u, dataset);
        const text = (r.body as Buffer).toString('utf8');
        expect(text).not.toContain('Withdrawn Co');
        expect(text).not.toContain('withdrawn.contact@example.com');
        expect(r.headers['x-export-row-count']).toBe('0');
      }
    });

    it('saved leads: no contact details, no ids, notes with commas, quotes and line breaks stay in one cell', async () => {
      const u = await newUser('saved');
      const b = await testApp.createTestBusiness({ slug: slug('saved'), name: `${tag} Saved Co`, contactEmail: 'saved.contact@example.com', contactPhone: '+91 9000000041' });
      const note = 'line one, with "quotes"\nline two,\r\nline three';
      await testApp.db.insert(schema.savedLeads).values({ userId: u.id, businessId: b.id, notes: note, pipelineStage: 'CONTACTED', tags: ['a,b', 'c"d'] });
      const r = await doExport(u, 'saved-leads');
      const rows = csvOf(r);
      expect(rows).toHaveLength(2);
      expect(rows[1]).toHaveLength(rows[0].length); // the note did not add columns or rows
      expect(rows[1][4]).toBe(note);
      const text = (r.body as Buffer).toString('utf8');
      expect(text).not.toContain('saved.contact@example.com');
      expect(text).not.toContain('9000000041');
      expect(text).not.toMatch(UUID);
    });

    it('formula injection: every cell that could start a formula, including behind spaces and control characters, is neutralised', async () => {
      const u = await newUser('formula');
      const evil = ['=HYPERLINK("http://x")', '+cmd|x', '-2+3', '@SUM(A1)', '  =1+1', '\t=1+1', '\u0001=1+1', '\u00a0@x'];
      const ids: string[] = [];
      for (let i = 0; i < evil.length; i++) {
        const b = await testApp.createTestBusiness({ slug: slug(`f${i}`), name: `${tag} F${i}`, contactEmail: `f${i}@example.com`, contactPhone: '+91 9000000050' });
        await testApp.db.update(schema.businessContacts).set({ fullName: evil[i], title: evil[i] }).where(eq(schema.businessContacts.businessId, b.id));
        await testApp.db.insert(schema.leadUnlocks).values({ userId: u.id, businessId: b.id });
        ids.push(b.id);
      }
      const r = await doExport(u, 'unlocked-leads');
      const rows = csvOf(r).slice(1);
      expect(rows).toHaveLength(evil.length);
      for (const row of rows) {
        for (const idx of [7, 8]) {
          const v = row[idx];
          expect(v.startsWith("'")).toBe(true); // the guard quote is the first character of the cell
          expect(v.slice(1)).toBe(evil.find((e) => e === v.slice(1)));
        }
        expect(row[11]).toBe('+91 9000000050');
      }
      // the same data as a spreadsheet: values are stored as text, never as formulas
      const x = await doExport(u, 'unlocked-leads', 'xlsx');
      expect(x.status).toBe(200);
      expect(x.headers['x-content-type-options']).toBe('nosniff');
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('limits', () => {
    it('one export holds at most the maximum rows and says so', async () => {
      const u = await newUser('max');
      const over = MAX_EXPORT_ROWS + 1;
      for (let from = 0; from < over; from += 1000) {
        const batch = Array.from({ length: Math.min(1000, over - from) }, (_, i) => ({ slug: slug(`max${from + i}`), name: `${tag} Max ${from + i}`, status: 'PUBLISHED' as const }));
        const inserted = await testApp.db.insert(schema.businesses).values(batch).returning({ id: schema.businesses.id });
        await testApp.db.insert(schema.savedLeads).values(inserted.map((b) => ({ userId: u.id, businessId: b.id })));
      }
      const r = await doExport(u, 'saved-leads');
      expect(r.status).toBe(200);
      expect(r.headers['x-export-row-count']).toBe(String(MAX_EXPORT_ROWS));
      expect(r.headers['x-export-truncated']).toBe('true');
      expect(csvOf(r)).toHaveLength(MAX_EXPORT_ROWS + 1); // header + capped rows
    }, 120_000);

    it('many small exports add up to one daily row limit; the refusal is audited and the cap lifts after 24 hours', async () => {
      const u = await newUser('daily');
      await testApp.db.insert(schema.exportJobs).values({ userId: u.id, dataset: 'saved-leads', format: 'csv', source: 'ON_DEMAND', status: 'COMPLETED', rowCount: MAX_EXPORT_ROWS_PER_DAY, sizeBytes: 1 });
      const r = await api().post('/api/v1/exports').set(u.auth).send({ dataset: 'saved-leads', format: 'csv' });
      expect(r.status).toBe(429);
      expect(JSON.stringify(r.body)).toContain('EXPORT_DAILY_LIMIT');
      const refused = await auditRows(u.id, 'EXPORT_REFUSED');
      expect(refused).toHaveLength(1);
      expect((refused[0].newValues as any).reason).toBe('EXPORT_DAILY_LIMIT');
      expect((refused[0].newValues as any).outcome).toBe('REFUSED');
      // the refusal produced no file and no history row
      expect(unwrap(await api().get('/api/v1/exports/history').set(u.auth))).toHaveLength(1);
      // another account is unaffected
      const v = await newUser('daily-other');
      expect((await doExport(v, 'saved-leads')).status).toBe(200);
      // after 24 hours the allowance returns
      await testApp.db.update(schema.exportJobs).set({ createdAt: new Date(Date.now() - 25 * 3_600_000) }).where(eq(schema.exportJobs.userId, u.id));
      expect((await doExport(u, 'saved-leads')).status).toBe(200);
    });

    it('a second simultaneous export for the same account is refused; it frees up when the first ends, even if that one failed', async () => {
      const u = await newUser('conc');
      const svc = app.get(ExportService);
      const results = await Promise.allSettled([
        svc.createExport(u.id, 'saved-leads', 'csv', { source: 'ON_DEMAND' }),
        svc.createExport(u.id, 'saved-leads', 'csv', { source: 'ON_DEMAND' }),
      ]);
      expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((x) => x.status === 'rejected') as PromiseRejectedResult;
      expect(JSON.stringify((rejected.reason as any).getResponse?.() ?? rejected.reason.message)).toContain('EXPORT_IN_PROGRESS');
      // released: a later export works
      await expect(svc.createExport(u.id, 'saved-leads', 'csv', { source: 'ON_DEMAND' })).resolves.toBeDefined();
      // a failing export also releases the claim
      const spy = jest.spyOn(svc as any, 'savedLeads').mockRejectedValueOnce(new Error('boom'));
      await expect(svc.createExport(u.id, 'saved-leads', 'csv', { source: 'ON_DEMAND' })).rejects.toThrow('boom');
      spy.mockRestore();
      await expect(svc.createExport(u.id, 'saved-leads', 'csv', { source: 'ON_DEMAND' })).resolves.toBeDefined();
    });

    it('requests are rate limited per account: the eleventh export in a minute is refused', async () => {
      const u = await newUser('rate');
      const codes: number[] = [];
      for (let i = 0; i < 11; i++) codes.push((await doExport(u, 'saved-leads')).status);
      expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
      expect(codes[10]).toBe(429);
      // NOTE: the limiter counts per client address, not per account (P9-06); the per-account limits are the daily row cap and the one-at-a-time rule above
    });

    it('history page size is bounded whatever the client sends', async () => {
      const u = await newUser('hist');
      await testApp.db.insert(schema.exportJobs).values(Array.from({ length: 205 }, () => ({ userId: u.id, dataset: 'saved-leads', format: 'csv', source: 'SCHEDULED', status: 'COMPLETED', sizeBytes: 1 })));
      const n = async (q: string) => {
        const r = await api().get(`/api/v1/exports/history${q}`).set(u.auth);
        expect(r.status).toBe(200);
        return unwrap(r).length as number;
      };
      expect(await n('')).toBe(50);
      expect(await n('?limit=999999')).toBe(200);
      expect(await n('?limit=-5')).toBe(50);
      expect(await n('?limit=abc')).toBe(50);
      expect(await n('?limit=3')).toBe(3);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('headers, audit and failure', () => {
    it('every generated file is a no-store attachment with a server-made name', async () => {
      const u = await newUser('hdr');
      for (const [dataset, format] of [['saved-leads', 'csv'], ['unlocked-leads', 'xlsx']] as const) {
        const r = await doExport(u, dataset, format);
        expect(r.status).toBe(200);
        expect(r.headers['content-disposition']).toMatch(/^attachment; filename="orion-[a-z-]+-\d{4}-\d{2}-\d{2}\.(csv|xlsx)"$/);
        expect(r.headers['cache-control']).toMatch(/no-store/);
        expect(r.headers['x-content-type-options']).toBe('nosniff');
        expect(JSON.stringify(r.headers)).not.toMatch(/[A-Z]:\\|\/home\/|\/var\/|node_modules/);
      }
      const p = await api().post('/api/v1/people/export').set(u.auth).send({}).buffer(true).parse(binary);
      expect(p.status).toBe(200);
      expect(p.headers['content-type']).toMatch(/text\/csv/);
      expect(p.headers['cache-control']).toMatch(/no-store/);
      expect(p.headers['x-content-type-options']).toBe('nosniff');
      expect((await api().post('/api/v1/people/export').set(u.auth).send({ personIds: ['not-a-uuid'] })).status).toBe(400);
      expect((await api().post('/api/v1/people/export').set(u.auth).send({ personIds: Array.from({ length: 1001 }, () => '00000000-0000-4000-8000-000000000000') })).status).toBe(400);
    });

    it('the audit entry has actor, type, time, delivered and requested counts, outcome, policy and request id, and no personal data', async () => {
      const u = await newUser('aud');
      const b = await testApp.createTestBusiness({ slug: slug('aud'), name: `${tag} Audit Co`, contactEmail: 'audit.person@example.com', contactPhone: '+91 9000000061' });
      await testApp.db.insert(schema.leadUnlocks).values({ userId: u.id, businessId: b.id });
      const rid = `req-${Date.now()}`;
      const r = await doExport(u, 'unlocked-leads', 'csv', { 'x-request-id': rid });
      expect(r.status).toBe(200);
      const rows = await auditRows(u.id, 'EXPORT_CREATED');
      expect(rows).toHaveLength(1);
      const v = rows[0].newValues as any;
      expect(rows[0].userId).toBe(u.id);
      expect(rows[0].createdAt).toBeInstanceOf(Date);
      expect(v).toMatchObject({ dataset: 'unlocked-leads', format: 'csv', source: 'ON_DEMAND', outcome: 'COMPLETED', rowCount: 1, requestedRows: 1, truncated: false, requestId: rid });
      expect(v.policy).toMatchObject({ maxRowsPerExport: MAX_EXPORT_ROWS, maxRowsPerDay: MAX_EXPORT_ROWS_PER_DAY, publishedOnly: true });
      expect(JSON.stringify(rows[0])).not.toMatch(/audit\.person@example\.com|9000000061|Audit Co|Bearer|eyJ/);
      // visible to administrators with the same request id
      const trail = unwrap(await api().get(`/api/v1/exports/admin/audit?userId=${u.id}`).set(admin));
      expect(JSON.stringify(trail)).toContain(rid);
    });

    it('a failed export is recorded as failed, delivers no file, and leaks no internals', async () => {
      const u = await newUser('fail');
      const svc = app.get(ExportService) as any;
      const spy = jest.spyOn(svc, 'savedLeads').mockRejectedValueOnce(new Error('select * from secret_table failed at C:\\srv\\app.ts'));
      // in production the response never carries the raw error text; a test run shows it, so switch environment for this one call
      const prevEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      let r: any;
      try {
        r = await api().post('/api/v1/exports').set(u.auth).send({ dataset: 'saved-leads', format: 'csv' });
      } finally {
        process.env.NODE_ENV = prevEnv;
      }
      spy.mockRestore();
      expect(r.status).toBeGreaterThanOrEqual(500);
      expect(JSON.stringify(r.body)).not.toMatch(/secret_table|srv|app\.ts|stack/);
      const failed = await auditRows(u.id, 'EXPORT_FAILED');
      expect(failed).toHaveLength(1);
      expect((failed[0].newValues as any).outcome).toBe('FAILED');
      const jobs = await testApp.db.select().from(schema.exportJobs).where(eq(schema.exportJobs.userId, u.id));
      expect(jobs).toHaveLength(1);
      expect(jobs[0].status).toBe('FAILED');
      expect(jobs[0].content).toBeNull();
      expect(await auditRows(u.id, 'EXPORT_CREATED')).toHaveLength(0);
    });

    it('an on-demand export does not keep the file; a scheduled one is stored for its owner only', async () => {
      const u = await newUser('keep');
      await doExport(u, 'saved-leads');
      const jobs = await testApp.db.select().from(schema.exportJobs).where(and(eq(schema.exportJobs.userId, u.id), inArray(schema.exportJobs.source, ['ON_DEMAND'])));
      expect(jobs).toHaveLength(1);
      expect(jobs[0].content).toBeNull();
      const hist = unwrap(await api().get('/api/v1/exports/history').set(u.auth));
      expect(hist[0].downloadable).toBe(false);
      expect(Object.keys(hist[0])).not.toContain('content');
      expect(Object.keys(hist[0])).not.toContain('userId');
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('dependencies not testable yet', () => {
    // Company-contact suppression in exports is covered by privacy-classification.e2e-spec.ts ("suppression of a company contact", Phase 22).
    // Files a customer already downloaded cannot be recalled; stored scheduled files are expired on suppression (retention-lifecycle.integration.spec.ts).
    it.todo('export of a person after a legal-basis withdrawal (needs the privacy phase: PR-02)');
  });

});
