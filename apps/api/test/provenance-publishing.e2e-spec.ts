import supertest from 'supertest';
const request = (supertest as any).default || supertest;
import * as jwt from 'jsonwebtoken';
import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { and, eq, inArray, like, sql } from 'drizzle-orm';
import { TestAppHelper } from './helpers/test-app.helper';
import { TEST_SECRETS } from './helpers/test-secrets';
import { gstinCheckChar } from '../src/modules/import/provenance/provenance.util';
import { PublishingService } from '../src/modules/import/services/publishing.service';
import { PublishWorker } from '../src/modules/import/workers/publish.worker';
import { ReviewService } from '../src/modules/import/services/review.service';
import { ReviewAction } from '@orion/shared';
import * as schema from '../src/database/schema';

/**
 * Phase 15: source trust, provenance, explicit publication, verification claims, merges and revocation, on the real application.
 * Synthetic businesses and people only.
 */
describe('Data provenance, source trust and publication controls (Phase 15)', () => {
  let testApp: TestAppHelper;
  let app: INestApplication;
  const api = () => request(app.getHttpServer());
  const unwrap = (res: any) => res.body.data || res.body;
  const adminEmail = 'qa.provenance.admin@monarchsoftwares.com';
  const customerEmail = `prov.customer.${Date.now()}@orion-test.io`;
  const tag = `zzprov${Date.now()}`;
  let admin = { Authorization: '' };
  let adminId = '';
  let customer = { Authorization: '' };
  let customerId = '';
  let seq = 0;

  /** A clean company row. Names and cities are unique so duplicate detection stays out of the way unless a test wants it. */
  const row = (extra: Record<string, unknown> = {}) => {
    seq++;
    return {
      business_name: `${tag} ${['Zephyr', 'Quartz', 'Nimbus', 'Onyx', 'Cobalt', 'Saffron', 'Indigo', 'Marigold'][seq % 8]}${seq} Exports`,
      city: `Provcity${seq}${Math.random().toString(36).slice(2, 5)}`,
      state: 'Karnataka',
      pincode: '560001',
      address_line1: `${seq} Test Road`,
      email: `contact${seq}@${tag}.example.com`,
      phone: '+91 98765 4321' + (seq % 10),
      contact_person: `Contact Person${seq}`,
      ...extra,
    };
  };
  const newSource = async (name: string, status?: 'APPROVED' | 'RESTRICTED' | 'REVOKED' | 'UNREVIEWED', restrictions?: string) => {
    const r = await api().post('/api/v1/admin/import/sources').set(admin).send({ name: `${tag} ${name}`, type: 'MANUAL_IMPORT', collectionMethod: 'CSV_UPLOAD' });
    expect(r.status).toBe(201);
    const id = unwrap(r).id as string;
    if (status && status !== 'UNREVIEWED') {
      const t = await api().patch(`/api/v1/admin/import/sources/${id}/trust`).set(admin).send({ status, reason: 'assessed in the provenance test', ...(restrictions ? { usageRestrictions: restrictions } : {}) });
      expect(t.status).toBe(200);
    }
    return id;
  };
  const submit = (rows: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) => api().post('/api/v1/admin/import/submit').set(admin).send({ filename: `${tag}.csv`, rows, ...extra });
  const publishBatch = (batchId: string, body: Record<string, unknown> = {}, who = admin) => api().post(`/api/v1/admin/import/publish-batch/${batchId}`).set(who).send(body);
  const bizByName = async (name: string) => (await testApp.db.select().from(schema.businesses).where(eq(schema.businesses.name, name)))[0];
  const auditRows = (action: string) => testApp.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, action));

  beforeAll(async () => {
    testApp = new TestAppHelper();
    app = await testApp.init();
    await testApp.cleanupUsers([adminEmail, customerEmail]);
    adminId = await testApp.provisionAdmin(adminEmail, 'SUPER_ADMIN');
    admin = { Authorization: `Bearer ${jwt.sign({ sub: adminId, email: adminEmail, role: 'SUPER_ADMIN', status: 'ACTIVE' }, TEST_SECRETS.jwtAccess, { expiresIn: '1h', issuer: 'orion-api', audience: 'orion-client' })}` };
    const reg = unwrap(await api().post('/api/v1/auth/register').send({ email: customerEmail, password: 'ProvPass123!', firstName: 'Pr', lastName: 'Cust' }));
    customerId = reg.user.id;
    customer = { Authorization: `Bearer ${reg.tokens.accessToken}` };
  });

  beforeEach(() => {
    (app.get(ThrottlerStorage) as any).storage.clear();
  });

  afterAll(async () => {
    const biz = await testApp.db.select({ slug: schema.businesses.slug }).from(schema.businesses).where(like(schema.businesses.name, `${tag}%`));
    await testApp.cleanupBusinesses(biz.map((b) => b.slug));
    await testApp.cleanupUsers([adminEmail, customerEmail]);
    await testApp.close();
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('who may manage sources, and every decision is recorded', () => {
    it('refuses anonymous callers and customers on every source route', async () => {
      const id = await newSource('authz');
      for (const [method, path, body] of [
        ['get', '/api/v1/admin/import/sources', undefined],
        ['post', '/api/v1/admin/import/sources', { name: 'x source', type: 'MANUAL_IMPORT' }],
        ['patch', `/api/v1/admin/import/sources/${id}/trust`, { status: 'APPROVED', reason: 'a customer tries to approve' }],
        ['post', `/api/v1/admin/import/sources/${id}/release-held`, { reason: 'a customer tries to release' }],
        ['get', `/api/v1/admin/import/sources/${id}/impact`, undefined],
        ['get', '/api/v1/admin/import/quality', undefined],
        ['post', '/api/v1/admin/import/publish-batch/00000000-0000-4000-8000-000000000000', {}],
      ] as const) {
        expect((await (api() as any)[method](path).send(body ?? {})).status).toBe(401);
        expect((await (api() as any)[method](path).set(customer).send(body ?? {})).status).toBe(403);
      }
      const after = await api().get('/api/v1/admin/import/sources').set(admin);
      expect(unwrap(after).find((s: any) => s.id === id).trustStatus).toBe('UNREVIEWED');
    });

    it('registering a source never approves it; unknown fields, bad types and bad ids are refused', async () => {
      const id = await newSource('register');
      const list = unwrap(await api().get('/api/v1/admin/import/sources').set(admin));
      expect(list.find((s: any) => s.id === id)).toMatchObject({ trustStatus: 'UNREVIEWED', collectionMethod: 'CSV_UPLOAD' });
      for (const body of [{ name: 'ok name', type: 'MANUAL_IMPORT', trustStatus: 'APPROVED' }, { name: 'ok name', type: 'NOT_A_TYPE' }, { name: 'x', type: 'MANUAL_IMPORT' }, { name: 'ok name', type: 'MANUAL_IMPORT', collectionMethod: 'not valid!' }]) {
        expect((await api().post('/api/v1/admin/import/sources').set(admin).send(body)).status).toBe(400);
      }
      expect((await api().patch('/api/v1/admin/import/sources/not-a-uuid/trust').set(admin).send({ status: 'APPROVED', reason: 'long enough reason' })).status).toBe(400);
    });

    it('a trust decision needs a reason, a restriction needs its text, and approval, restriction and revocation are each audited with old and new status', async () => {
      const id = await newSource('decisions');
      const patch = (b: Record<string, unknown>) => api().patch(`/api/v1/admin/import/sources/${id}/trust`).set(admin).send(b);
      expect((await patch({ status: 'APPROVED' })).status).toBe(400);
      expect((await patch({ status: 'APPROVED', reason: 'short' })).status).toBe(400);
      expect((await patch({ status: 'APPROVED', reason: 'reviewed the licence terms', isActive: false, trustStatus: 'APPROVED' })).status).toBe(400); // no extra fields
      expect((await patch({ status: 'RESTRICTED', reason: 'terms allow internal use only' })).status).toBe(400);
      expect((await patch({ status: 'APPROVED', reason: 'reviewed the licence terms' })).status).toBe(200);
      expect((await patch({ status: 'RESTRICTED', reason: 'terms allow internal use only', usageRestrictions: 'Internal use; no redistribution' })).status).toBe(200);
      expect((await patch({ status: 'REVOKED', reason: 'licence withdrawn by the provider' })).status).toBe(200);
      for (const [action, from, to] of [['SOURCE_APPROVED', 'UNREVIEWED', 'APPROVED'], ['SOURCE_RESTRICTED', 'APPROVED', 'RESTRICTED'], ['SOURCE_REVOKED', 'RESTRICTED', 'REVOKED']] as const) {
        const mine = (await auditRows(action)).find((r) => r.entityId === id)!;
        expect(mine).toBeDefined();
        expect(mine.userId).toBe(adminId);
        expect(mine.oldValues).toMatchObject({ trustStatus: from });
        expect(mine.newValues).toMatchObject({ trustStatus: to, outcome: 'SUCCESS' });
      }
      expect((await auditRows('SOURCE_REGISTERED')).some((r) => r.entityId === id)).toBe(true);
      const view = unwrap(await api().get('/api/v1/admin/import/sources').set(admin)).find((s: any) => s.id === id);
      expect(view).toMatchObject({ trustStatus: 'REVOKED', trustDecidedById: adminId });
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('publication is an explicit administrator step', () => {
    it('with no source named, a clean import waits in the publish queue: nothing is published, nothing is discoverable', async () => {
      const r = row();
      const res = await submit([r], { autoPublish: true }); // even when asked to publish automatically
      expect(res.status).toBe(201);
      const d = unwrap(res);
      expect(d).toMatchObject({ publishedCount: 0, awaitingPublishCount: 1, failedCount: 0 });
      expect(d.integrity.ok).toBe(true);
      expect(await bizByName(r.business_name)).toBeUndefined();
      const rec = (await testApp.db.select().from(schema.importRecords).where(eq(schema.importRecords.batchId, d.batchId)))[0];
      expect(rec.status).toBe('APPROVED');
      const q = await testApp.db.select().from(schema.publishQueue).where(eq(schema.publishQueue.recordId, rec.id));
      expect(q).toHaveLength(1);
      expect(q[0].status).toBe('PENDING');
      const found = await api().get(`/api/v1/discover/search?q=${encodeURIComponent(r.business_name)}`).set(customer);
      expect(JSON.stringify(unwrap(found))).not.toContain(r.business_name);
    });

    it('the default is the same: no flag, no automatic publication', async () => {
      const r = row();
      const d = unwrap(await submit([r]));
      expect(d.publishedCount).toBe(0);
      expect(d.awaitingPublishCount).toBe(1);
      expect(await bizByName(r.business_name)).toBeUndefined();
    });

    it.each(['UNREVIEWED', 'RESTRICTED'] as const)('automatic publication is refused for a %s source: the record stays queued, and the refusal is audited', async (status) => {
      const src = await newSource(`auto-${status}`, status === 'RESTRICTED' ? 'RESTRICTED' : undefined, 'Internal use only');
      const r = row();
      const d = unwrap(await submit([r], { autoPublish: true, sourceId: src }));
      expect(d).toMatchObject({ publishedCount: 0, awaitingPublishCount: 1 });
      expect(await bizByName(r.business_name)).toBeUndefined();
      const refusals = (await auditRows('PUBLISH_REFUSED')).filter((x) => (x.newValues as any)?.batchId === d.batchId);
      expect(refusals).toHaveLength(1);
      expect(refusals[0].newValues).toMatchObject({ outcome: 'DENIED', failureCategory: 'SOURCE_NOT_APPROVED', via: 'AUTO', sourceTrust: status });
    });

    it('an approved source with an explicit request publishes automatically, with full provenance written by the server', async () => {
      const src = await newSource('auto-approved', 'APPROVED');
      const r = row();
      const res = await submit([r], { autoPublish: true, sourceId: src });
      const d = unwrap(res);
      expect(d).toMatchObject({ publishedCount: 1, awaitingPublishCount: 0 });
      const biz = await bizByName(r.business_name);
      expect(biz.status).toBe('PUBLISHED');
      expect(biz.sourceId).toBe(src);
      expect(biz.isVerified).toBe(false);
      const meta = biz.metadata as any;
      expect(meta.provenance.origin).toMatchObject({ sourceId: src, sourceTrust: 'APPROVED', collectionMethod: 'CSV_UPLOAD', batchId: d.batchId, publishMode: 'CREATE', overrideUsed: false, publishedById: null });
      expect(meta.provenance.origin.recordId).toBeTruthy();
      expect(meta.provenance.origin.rowNumber).toBe(1);
      expect(new Date(meta.provenance.origin.importedAt).getTime()).toBeLessThanOrEqual(new Date(meta.provenance.origin.publishedAt).getTime());
      expect(meta.verification.business).toBe('UNVERIFIED');
      const hist = (await testApp.db.select().from(schema.businessHistory).where(eq(schema.businessHistory.businessId, biz.id)))[0];
      expect(hist.sourceBatchId).toBe(d.batchId);
      expect(hist.changeType).toBe('INITIAL_CREATION');
      expect((await auditRows('IMPORT_RECORD_PUBLISHED')).some((x) => x.entityId === biz.id && (x.newValues as any).via === 'AUTO')).toBe(true);
    });

    it('batch publish by an administrator: unnamed source refused without the override, published with it, and the override is audited', async () => {
      const r = row();
      const d = unwrap(await submit([r]));
      const refused = unwrap(await publishBatch(d.batchId));
      expect(refused).toMatchObject({ newlyPublished: 0, refused: 1, refusalCodes: { SOURCE_NOT_APPROVED: 1 } });
      expect(await bizByName(r.business_name)).toBeUndefined();
      const ok = unwrap(await publishBatch(d.batchId, { allowUnreviewedSource: true }));
      expect(ok).toMatchObject({ newlyPublished: 1, refused: 0 });
      const biz = await bizByName(r.business_name);
      expect(biz.status).toBe('PUBLISHED');
      expect(biz.sourceId).toBeNull(); // unknown provenance is stored as unknown, never invented
      const origin = (biz.metadata as any).provenance.origin;
      expect(origin).toMatchObject({ sourceId: null, sourceName: null, sourceTrust: 'NONE', overrideUsed: true, publishedById: adminId, batchId: d.batchId });
      const ov = (await auditRows('PUBLISH_OVERRIDE_USED')).find((x) => x.entityId === biz.id)!;
      expect(ov.userId).toBe(adminId);
      expect(ov.newValues).toMatchObject({ via: 'ADMIN', sourceTrust: 'NONE', batchId: d.batchId });
      // publishing again publishes nothing twice
      expect(unwrap(await publishBatch(d.batchId, { allowUnreviewedSource: true })).newlyPublished).toBe(0);
    });

    it('a revoked source is refused even with the override; a source the admin approved later publishes without it', async () => {
      const src = await newSource('revoked-later');
      const r1 = row();
      const d1 = unwrap(await submit([r1], { sourceId: src }));
      await api().patch(`/api/v1/admin/import/sources/${src}/trust`).set(admin).send({ status: 'REVOKED', reason: 'licence withdrawn after import' });
      const res = unwrap(await publishBatch(d1.batchId, { allowUnreviewedSource: true }));
      expect(res).toMatchObject({ newlyPublished: 0, refused: 1, refusalCodes: { SOURCE_REVOKED: 1 } });
      expect(await bizByName(r1.business_name)).toBeUndefined();

      const src2 = await newSource('approved-later');
      const r2 = row();
      const d2 = unwrap(await submit([r2], { sourceId: src2 }));
      expect(unwrap(await publishBatch(d2.batchId)).refused).toBe(1);
      await api().patch(`/api/v1/admin/import/sources/${src2}/trust`).set(admin).send({ status: 'APPROVED', reason: 'terms reviewed after import' });
      expect(unwrap(await publishBatch(d2.batchId))).toMatchObject({ newlyPublished: 1, refused: 0 });
    });

    it('an unregistered source id is refused at submit', async () => {
      expect((await submit([row()], { sourceId: '00000000-0000-4000-8000-000000000000' })).status).toBe(400);
      expect((await submit([row()], { sourceId: 'not-a-uuid' })).status).toBe(400);
    });

    it('no other route publishes: a customer cannot, a queue worker cannot, and a direct service call without an administrator cannot', async () => {
      const r = row();
      const d = unwrap(await submit([r]));
      expect((await publishBatch(d.batchId, { allowUnreviewedSource: true }, customer)).status).toBe(403);
      const rec = (await testApp.db.select().from(schema.importRecords).where(eq(schema.importRecords.batchId, d.batchId)))[0];
      const q = (await testApp.db.select().from(schema.publishQueue).where(eq(schema.publishQueue.recordId, rec.id)))[0];
      const svc = app.get(PublishingService);
      await expect(svc.publishRecord(q.id)).rejects.toMatchObject({ errorCode: 'PUBLISH_NOT_AUTHORIZED' });
      await expect(svc.publishRecord(q.id, { via: 'ADMIN' })).rejects.toMatchObject({ errorCode: 'PUBLISH_NOT_AUTHORIZED' });
      await expect(svc.publishRecord(q.id, { via: 'AUTO' })).rejects.toMatchObject({ errorCode: 'AUTO_PUBLISH_NOT_REQUESTED' });
      await expect(app.get(PublishWorker).processJob({ data: { publishQueueId: q.id } } as any)).rejects.toMatchObject({ errorCode: 'PUBLISH_NOT_AUTHORIZED' });
      expect(await bizByName(r.business_name)).toBeUndefined();
      expect((await testApp.db.select().from(schema.publishQueue).where(eq(schema.publishQueue.id, q.id)))[0].status).toBe('PENDING');
      const denied = (await auditRows('PUBLISH_REFUSED')).filter((x) => x.entityId === q.id);
      expect(denied.length).toBeGreaterThanOrEqual(3);
      expect(denied.every((x) => (x.newValues as any).outcome === 'DENIED')).toBe(true);
    });

    it('the record is validated again at the moment of publication: a payload edited into an invalid state is refused', async () => {
      const r = row();
      const d = unwrap(await submit([r]));
      const rec = (await testApp.db.select().from(schema.importRecords).where(eq(schema.importRecords.batchId, d.batchId)))[0];
      const np = { ...(rec.normalizedPayload as any), name: '' };
      await testApp.db.update(schema.importRecords).set({ normalizedPayload: np }).where(eq(schema.importRecords.id, rec.id));
      const res = unwrap(await publishBatch(d.batchId, { allowUnreviewedSource: true }));
      expect(res).toMatchObject({ newlyPublished: 0, refused: 1, refusalCodes: { VALIDATION_FAILED: 1 } });
      expect((await auditRows('PUBLISH_REFUSED')).some((x) => (x.newValues as any).recordId === rec.id && (x.newValues as any).failedRules?.includes('REQUIRED_BUSINESS_NAME'))).toBe(true);
    });

    it('a record that is not approved (a failed validation, a flagged duplicate) cannot be pushed through the publish queue', async () => {
      const bad = { ...row(), business_name: '', state: '' };
      const d = unwrap(await submit([bad]));
      expect(d.failedCount).toBe(1);
      const rec = (await testApp.db.select().from(schema.importRecords).where(eq(schema.importRecords.batchId, d.batchId)))[0];
      expect(rec.status).toBe('FAILED');
      const [q] = await testApp.db.insert(schema.publishQueue).values({ recordId: rec.id, publishMode: 'CREATE', status: 'PENDING' }).returning();
      await expect(app.get(PublishingService).publishRecord(q.id, { via: 'ADMIN', actorId: adminId, allowUnreviewedSource: true })).rejects.toMatchObject({ errorCode: 'RECORD_NOT_APPROVED' });
    });

    it('a publish that fails part-way leaves no partial business: the transaction rolls back and the failure is audited', async () => {
      const gst = '27AAACT2727Q1ZW';
      const existing = await testApp.createTestBusiness({ slug: `${tag}-owner`, name: `${tag} Existing Owner`, contactEmail: 'owner@example.com', contactPhone: '+91 9000000091' });
      await testApp.db.insert(schema.businessIdentifiers).values({ businessId: existing.id, type: 'GSTIN', value: gst, normalizedValue: gst });
      const r = row({ gstin: gst });
      const d = unwrap(await submit([r]));
      // the detector flagged it as a duplicate of the existing owner; force it into the queue as a plain CREATE, as a concurrent import would have been
      const rec = (await testApp.db.select().from(schema.importRecords).where(eq(schema.importRecords.batchId, d.batchId)))[0];
      await testApp.db.update(schema.importRecords).set({ status: 'APPROVED' }).where(eq(schema.importRecords.id, rec.id));
      const [q] = await testApp.db.insert(schema.publishQueue).values({ recordId: rec.id, publishMode: 'CREATE', status: 'PENDING' }).returning();
      await expect(app.get(PublishingService).publishRecord(q.id, { via: 'ADMIN', actorId: adminId, allowUnreviewedSource: true })).rejects.toBeDefined();
      expect(await bizByName(r.business_name)).toBeUndefined();
      const after = (await testApp.db.select().from(schema.publishQueue).where(eq(schema.publishQueue.id, q.id)))[0];
      expect(after.status).toBe('FAILED');
      expect((await auditRows('PUBLISH_FAILED')).some((x) => x.entityId === q.id)).toBe(true);
      expect((await testApp.db.select().from(schema.businessIdentifiers).where(eq(schema.businessIdentifiers.normalizedValue, gst))).length).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('what an import may claim', () => {
    it('columns an import carries cannot set trusted fields: status, verification, source, publication and audit values come from the server', async () => {
      const other = await newSource('other-source', 'APPROVED');
      const r = row({ status: 'PUBLISHED', is_verified: 'true', isVerified: true, verified: 'yes', source_id: other, sourceId: other, trust_status: 'APPROVED', published_at: '2020-01-01', publishedAt: '2020-01-01', verified_at: '2020-01-01', created_by: customerId, metadata: '{"provenance":{"origin":{"sourceTrust":"APPROVED"}}}', is_email_verified: 'true', is_phone_verified: 'true' });
      const d = unwrap(await submit([r]));
      expect(d.publishedCount).toBe(0);
      expect(await bizByName(r.business_name)).toBeUndefined();
      expect(unwrap(await publishBatch(d.batchId, { allowUnreviewedSource: true })).newlyPublished).toBe(1);
      const biz = await bizByName(r.business_name);
      expect(biz.isVerified).toBe(false);
      expect(biz.sourceId).toBeNull(); // not the source id the file claimed
      expect(biz.publishedAt!.getTime()).toBeGreaterThan(new Date('2021-01-01').getTime());
      const origin = (biz.metadata as any).provenance.origin;
      expect(origin.sourceTrust).toBe('NONE');
      expect(origin.overrideUsed).toBe(true);
      expect(origin.publishedById).toBe(adminId);
      const [c] = await testApp.db.select().from(schema.businessContacts).where(eq(schema.businessContacts.businessId, biz.id));
      expect(c.isEmailVerified).toBe(false);
      expect(c.isPhoneVerified).toBe(false);
      expect(JSON.stringify(biz.metadata)).not.toContain('2020-01-01');
    });

    it('format-valid contact values are published as FORMAT_VALID only; malformed values are not published and are listed by field name; identifiers get their real level', async () => {
      const g = `29AAACI4798L1Z${gstinCheckChar('29AAACI4798L1Z')}`;
      const good = row({ gstin: g, cin: 'U12345KA2010PTC123456' });
      const bad = row({ email: 'not-an-email', phone: '12345', gstin: '29AAACI4798L1Z0', pan: 'BADPAN' });
      const d = unwrap(await submit([good, bad]));
      expect(unwrap(await publishBatch(d.batchId, { allowUnreviewedSource: true })).newlyPublished).toBe(2);

      const gb = await bizByName(good.business_name);
      const [gc] = await testApp.db.select().from(schema.businessContacts).where(eq(schema.businessContacts.businessId, gb.id));
      expect(gc.email).toBe(good.email);
      expect(gc.isEmailVerified).toBe(false);
      expect((gc.metadata as any).verification).toMatchObject({ email: 'FORMAT_VALID', phone: 'FORMAT_VALID', highestPossible: 'FORMAT_VALID' });
      expect((gc.metadata as any).source.batchId).toBe(d.batchId);
      expect((gb.metadata as any).verification.identifiers).toMatchObject({ GSTIN: 'STRUCTURE_VALID', CIN: 'FORMAT_VALID' });
      expect((gb.metadata as any).quality.droppedValues).toEqual([]);

      const bb = await bizByName(bad.business_name);
      const [bc] = await testApp.db.select().from(schema.businessContacts).where(eq(schema.businessContacts.businessId, bb.id));
      expect(bc.email).toBeNull();
      expect(bc.phone).toBeNull();
      const ids = await testApp.db.select().from(schema.businessIdentifiers).where(eq(schema.businessIdentifiers.businessId, bb.id));
      expect(ids.some((i) => i.type === 'PAN')).toBe(false); // a malformed PAN is not presented as data
      const dropped = (bb.metadata as any).quality;
      expect(dropped.needsReview).toBe(true);
      expect(dropped.droppedValues.map((x: any) => x.field).sort()).toEqual(['contacts[0].email', 'contacts[0].phone', 'identifiers.PAN']);
      expect(JSON.stringify(dropped)).not.toContain('not-an-email'); // field names only: the value is not copied
      // a wrong-check-character GSTIN is kept as supplied but only FORMAT_VALID
      expect((bb.metadata as any).verification.identifiers.GSTIN).toBe('FORMAT_VALID');
    });

    it('validation logs and reports do not copy contact values', async () => {
      const r = row({ email: 'leaky.value@broken', phone: '999' });
      const d = unwrap(await submit([r]));
      const rec = (await testApp.db.select().from(schema.importRecords).where(eq(schema.importRecords.batchId, d.batchId)))[0];
      const logs = await testApp.db.select().from(schema.validationLogs).where(eq(schema.validationLogs.recordId, rec.id));
      expect(logs.some((l) => l.ruleName === 'INVALID_EMAIL_FORMAT')).toBe(true);
      const text = JSON.stringify(logs);
      expect(text).not.toContain('leaky.value@broken');
      expect(text).not.toContain('999');
    });

    it('customers never see provenance, source, quality or hold data on a business', async () => {
      const src = await newSource('customer-view', 'APPROVED');
      const r = row();
      unwrap(await submit([r], { autoPublish: true, sourceId: src }));
      const biz = await bizByName(r.business_name);
      for (const who of [customer, {}]) {
        const res = await api().get(`/api/v1/discover/businesses/${biz.slug}`).set(who);
        expect(res.status).toBe(200);
        const json = JSON.stringify(unwrap(res));
        expect(json).not.toMatch(/provenance|trustStatus|usageRestrictions|heldBySource|droppedValues|needsReview|sourceBatch|metadata/i);
        expect(json).not.toContain(src);
      }
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('duplicates, merges and conflicts', () => {
    it('a statutory identifier match flags a duplicate for review, a matching name alone in another city does not, and a missing identifier never matches', async () => {
      const src = await newSource('dups', 'APPROVED');
      const g = `27AAACD1234E1Z${gstinCheckChar('27AAACD1234E1Z')}`;
      const first = row({ gstin: g });
      expect(unwrap(await submit([first], { autoPublish: true, sourceId: src })).publishedCount).toBe(1);
      const sameId = row({ gstin: g }); // different name and city, same GSTIN
      const sameName = { ...row(), business_name: first.business_name }; // same name, different city, no identifier
      const noIds = [row({ gstin: '' }), row({ gstin: '' })]; // two rows with no identifier
      const d = unwrap(await submit([sameId, sameName, ...noIds], { autoPublish: true, sourceId: src }));
      expect(d.duplicateCount).toBe(1); // only the GSTIN match
      expect(d.publishedCount).toBe(3);
      const flagged = await testApp.db.select().from(schema.importRecords).where(and(eq(schema.importRecords.batchId, d.batchId), eq(schema.importRecords.status, 'FLAGGED_DUPLICATE')));
      expect(flagged).toHaveLength(1);
      const cand = await testApp.db.select().from(schema.duplicateCandidates).where(eq(schema.duplicateCandidates.recordId, flagged[0].id));
      expect(cand[0].matchType).toBe('IDENTIFIER');
      expect(cand).toHaveLength(1);
    });

    it('a reviewer merge adds what is missing, keeps what is published, records the disagreement, appends provenance and leaves the business id, unlocks and history intact', async () => {
      const src = await newSource('merge', 'APPROVED');
      const g = `27AAACM1234F1Z${gstinCheckChar('27AAACM1234F1Z')}`;
      const first = row({ gstin: g, founding_year: 1990 });
      unwrap(await submit([first], { autoPublish: true, sourceId: src }));
      const biz = await bizByName(first.business_name);
      await testApp.db.insert(schema.leadUnlocks).values({ userId: customerId, businessId: biz.id });
      const before = (await testApp.db.select().from(schema.businessContacts).where(eq(schema.businessContacts.businessId, biz.id))).length;

      const incoming = row({ gstin: g, founding_year: 1995, description: 'Added by the second source', contact_person: 'Second Person', email: `second.${tag}@example.com`, phone: '+91 22 67789999' });
      const d = unwrap(await submit([incoming], { autoPublish: true, sourceId: src }));
      expect(d.duplicateCount).toBe(1);
      const rec = (await testApp.db.select().from(schema.importRecords).where(and(eq(schema.importRecords.batchId, d.batchId), eq(schema.importRecords.status, 'FLAGGED_DUPLICATE'))))[0];
      const [review] = await testApp.db.select().from(schema.reviewQueue).where(eq(schema.reviewQueue.recordId, rec.id));
      await app.get(ReviewService).processReviewDecision({ reviewId: review.id, decision: ReviewAction.MERGE, reviewerId: adminId, targetBusinessId: biz.id, notes: 'same company' });
      const res = unwrap(await publishBatch(d.batchId));
      expect(res).toMatchObject({ newlyPublished: 1, refused: 0 });

      const after = (await testApp.db.select().from(schema.businesses).where(eq(schema.businesses.id, biz.id)))[0];
      expect(after.id).toBe(biz.id);
      expect(after.name).toBe(first.business_name); // not overwritten
      expect(after.foundingYear).toBe(1990); // differing value kept, recorded as a conflict
      expect(after.description).toBe('Added by the second source'); // missing value added
      const meta = after.metadata as any;
      expect(meta.provenance.origin.batchId).not.toBe(d.batchId); // the first publication's origin is never rewritten
      expect(meta.provenance.history).toHaveLength(1);
      expect(meta.provenance.history[0]).toMatchObject({ mode: 'MERGE', batchId: d.batchId, sourceId: src });
      expect(meta.provenance.history[0].fieldsAdded).toEqual(expect.arrayContaining(['description', 'contact']));
      expect(meta.quality.conflicts.map((c: any) => c.field)).toContain('foundingYear');
      expect(meta.quality.needsReview).toBe(true);
      expect(JSON.stringify(meta.quality)).not.toContain(`second.${tag}`); // no contact value is copied into the conflict log
      const contacts = await testApp.db.select().from(schema.businessContacts).where(eq(schema.businessContacts.businessId, biz.id));
      expect(contacts.length).toBe(before + 1);
      expect(contacts.some((c) => c.email === `second.${tag}@example.com`)).toBe(true);
      expect(contacts.some((c) => c.email === first.email)).toBe(true); // the existing contact is untouched
      const unlock = await testApp.db.select().from(schema.leadUnlocks).where(and(eq(schema.leadUnlocks.userId, customerId), eq(schema.leadUnlocks.businessId, biz.id)));
      expect(unlock).toHaveLength(1);
      const hist = await testApp.db.select().from(schema.businessHistory).where(eq(schema.businessHistory.businessId, biz.id));
      expect(hist.map((h) => h.changeType).sort()).toEqual(['IMPORT_MERGE', 'INITIAL_CREATION']);
      expect(JSON.stringify(hist.find((h) => h.changeType === 'IMPORT_MERGE')!.fullSnapshot)).not.toContain('@');
      expect((await testApp.db.select().from(schema.importRecords).where(eq(schema.importRecords.id, rec.id)))[0].status).toBe('PUBLISHED');
      expect((await auditRows('IMPORT_REVIEW_DECISION')).some((x) => x.entityId === rec.id && x.userId === adminId)).toBe(true);
    });

    it('a different identifier of a kind the business already has is kept as a conflict, never swapped in; the published one stays', async () => {
      const src = await newSource('merge-ident', 'APPROVED');
      const g1 = `27AAACX1234J1Z${gstinCheckChar('27AAACX1234J1Z')}`;
      const g2 = `27AAACY1234K1Z${gstinCheckChar('27AAACY1234K1Z')}`;
      const site = `https://www.${tag}-merge-ident${seq}.example.com`;
      const first = row({ gstin: g1, website: site });
      unwrap(await submit([first], { autoPublish: true, sourceId: src }));
      const biz = await bizByName(first.business_name);
      const d = unwrap(await submit([row({ gstin: g2, website: site })], { autoPublish: true, sourceId: src })); // same website domain, different GSTIN
      expect(d.duplicateCount).toBe(1);
      const rec = (await testApp.db.select().from(schema.importRecords).where(and(eq(schema.importRecords.batchId, d.batchId), eq(schema.importRecords.status, 'FLAGGED_DUPLICATE'))))[0];
      const [review] = await testApp.db.select().from(schema.reviewQueue).where(eq(schema.reviewQueue.recordId, rec.id));
      await app.get(ReviewService).processReviewDecision({ reviewId: review.id, decision: ReviewAction.MERGE, reviewerId: adminId, targetBusinessId: biz.id });
      expect(unwrap(await publishBatch(d.batchId)).newlyPublished).toBe(1);
      const ids = await testApp.db.select().from(schema.businessIdentifiers).where(eq(schema.businessIdentifiers.businessId, biz.id));
      expect(ids.filter((i) => i.type === 'GSTIN').map((i) => i.normalizedValue)).toEqual([g1]);
      const meta = (await testApp.db.select().from(schema.businesses).where(eq(schema.businesses.id, biz.id)))[0].metadata as any;
      expect(meta.quality.conflicts.map((c: any) => c.field)).toContain('identifier:GSTIN');
      expect(meta.quality.needsReview).toBe(true);
    });

    it('a merge decision is refused for a business that does not exist, and an edited record that fails validation is refused', async () => {
      const src = await newSource('merge-guard', 'APPROVED');
      const g = `27AAACG1234H1Z${gstinCheckChar('27AAACG1234H1Z')}`;
      unwrap(await submit([row({ gstin: g })], { autoPublish: true, sourceId: src }));
      const d = unwrap(await submit([row({ gstin: g })], { autoPublish: true, sourceId: src }));
      const rec = (await testApp.db.select().from(schema.importRecords).where(and(eq(schema.importRecords.batchId, d.batchId), eq(schema.importRecords.status, 'FLAGGED_DUPLICATE'))))[0];
      const [review] = await testApp.db.select().from(schema.reviewQueue).where(eq(schema.reviewQueue.recordId, rec.id));
      const rs = app.get(ReviewService);
      await expect(rs.processReviewDecision({ reviewId: review.id, decision: ReviewAction.MERGE, reviewerId: adminId, targetBusinessId: '00000000-0000-4000-8000-000000000000' })).rejects.toThrow(/does not exist/);
      await expect(rs.processReviewDecision({ reviewId: review.id, decision: ReviewAction.EDIT, reviewerId: adminId, editedPayload: { ...(rec.normalizedPayload as any), name: '' } })).rejects.toThrow(/validation/);
      await expect(rs.processReviewDecision({ reviewId: review.id, decision: ReviewAction.EDIT, reviewerId: adminId })).rejects.toThrow(/edited payload/);
      expect((await auditRows('IMPORT_REVIEW_REFUSED')).some((x) => x.entityId === review.id)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('revoking a source takes its records out of every customer path, reversibly', () => {
    it('hides discovery, detail, unlock and export for what the source published, refuses republishing, and can be released after re-approval', async () => {
      const src = await newSource('revocable', 'APPROVED');
      const r = row();
      unwrap(await submit([r], { autoPublish: true, sourceId: src }));
      const biz = await bizByName(r.business_name);
      // the customer can find it, unlock it and export it
      expect(JSON.stringify(unwrap(await api().get(`/api/v1/discover/search?q=${encodeURIComponent(r.business_name)}`).set(customer)))).toContain(r.business_name);
      expect((await api().post('/api/v1/unlock/business').set(customer).send({ businessId: biz.id })).status).toBe(200);
      const exp = async () => (await api().post('/api/v1/exports').set(customer).send({ dataset: 'unlocked-leads', format: 'csv' })).text;
      expect(await exp()).toContain(r.business_name);

      const impact = unwrap(await api().get(`/api/v1/admin/import/sources/${src}/impact`).set(admin));
      expect(impact.businessesByStatus.PUBLISHED).toBe(1);

      const rev = unwrap(await api().patch(`/api/v1/admin/import/sources/${src}/trust`).set(admin).send({ status: 'REVOKED', reason: 'provider withdrew the licence' }));
      expect(rev.businessesHeldBack).toBe(1);
      const held = (await testApp.db.select().from(schema.businesses).where(eq(schema.businesses.id, biz.id)))[0];
      expect(held.status).toBe('PENDING_VALIDATION');
      expect((held.metadata as any).heldBySource).toMatchObject({ sourceId: src, previousStatus: 'PUBLISHED', reason: 'SOURCE_REVOKED' });
      expect((await auditRows('SOURCE_REVOKED')).find((x) => x.entityId === src)!.newValues).toMatchObject({ businessesHeldBack: 1 });

      expect(JSON.stringify(unwrap(await api().get(`/api/v1/discover/search?q=${encodeURIComponent(r.business_name)}`).set(customer)))).not.toContain(r.business_name);
      expect((await api().get(`/api/v1/discover/businesses/${biz.slug}`).set(customer)).status).toBe(404);
      const other = row();
      expect((await api().post('/api/v1/unlock/business').set(customer).send({ businessId: biz.id })).status).toBeGreaterThanOrEqual(400); // already unlocked once; still not served
      expect(await exp()).not.toContain(r.business_name);
      void other;

      // no path can publish it again while the source is revoked (here: the raw database guard that also covers the web gateway's status screen)
      await expect(testApp.db.update(schema.businesses).set({ status: 'PUBLISHED' }).where(eq(schema.businesses.id, biz.id))).rejects.toBeDefined();
      expect((await testApp.db.select().from(schema.businesses).where(eq(schema.businesses.id, biz.id)))[0].status).toBe('PENDING_VALIDATION');
      expect((await api().post(`/api/v1/admin/import/sources/${src}/release-held`).set(admin).send({ reason: 'trying to release too early' })).status).toBe(409);

      // reversible: approve again and release
      await api().patch(`/api/v1/admin/import/sources/${src}/trust`).set(admin).send({ status: 'APPROVED', reason: 'licence restored by the provider' });
      const rel = unwrap(await api().post(`/api/v1/admin/import/sources/${src}/release-held`).set(admin).send({ reason: 'licence restored, releasing' }));
      expect(rel.released).toBe(1);
      const back = (await testApp.db.select().from(schema.businesses).where(eq(schema.businesses.id, biz.id)))[0];
      expect(back.status).toBe('PUBLISHED');
      expect((back.metadata as any).heldBySource).toBeUndefined();
      expect(await exp()).toContain(r.business_name);
      expect((await testApp.db.select().from(schema.leadUnlocks).where(and(eq(schema.leadUnlocks.userId, customerId), eq(schema.leadUnlocks.businessId, biz.id)))).length).toBe(1);
    });

    it('businesses with no recorded source are not touched by a revocation (they cannot be attributed)', async () => {
      const src = await newSource('revoke-other', 'APPROVED');
      const legacy = await testApp.createTestBusiness({ slug: `${tag}-legacy`, name: `${tag} Legacy Co`, contactEmail: 'legacy@example.com', contactPhone: '+91 9000000092' });
      await api().patch(`/api/v1/admin/import/sources/${src}/trust`).set(admin).send({ status: 'REVOKED', reason: 'revoking an unrelated source' });
      expect((await testApp.db.select().from(schema.businesses).where(eq(schema.businesses.id, legacy.id)))[0].status).toBe('PUBLISHED');
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe('data-quality overview', () => {
    it('gives counts to administrators only, without record content', async () => {
      const res = await api().get('/api/v1/admin/import/quality').set(admin);
      expect(res.status).toBe(200);
      const q = unwrap(res);
      for (const k of ['importRecordsByStatus', 'publishQueueByStatus', 'sourcesByTrust', 'businessesByStatus', 'businessesNeedingReview', 'businessesWithStaleChecks', 'businessesFromUnapprovedSources', 'publishedBusinessesWithUnknownProvenance']) expect(q).toHaveProperty(k);
      expect(q.sourcesByTrust).toHaveProperty('APPROVED');
      expect(typeof q.businessesNeedingReview).toBe('number');
      expect(JSON.stringify(q)).not.toMatch(/@|contact_person|business_name/);
    });
  });

  it('keeps unused helpers honest', () => {
    void inArray;
    void sql;
  });
});
