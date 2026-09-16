import supertest from 'supertest';
const request = (supertest as any).default || supertest;
import { INestApplication } from '@nestjs/common';
import { TestAppHelper } from './helpers/test-app.helper';

describe('Sprint 16: Saved Leads & Saved Searches E2E Tests', () => {
  let testApp: TestAppHelper;
  let app: INestApplication;

  const testBizSlug = 'saved-qa-enterprise-corp';
  let testBizId: string;

  const testUserEmail = 'saved.tester@orion-test.io';
  const testUserPassword = 'SavedPassword123!';
  let userToken: string;
  let userId: string;

  beforeAll(async () => {
    testApp = new TestAppHelper();
    app = await testApp.init();

    await testApp.cleanupUsers([testUserEmail]);
    await testApp.cleanupBusinesses([testBizSlug]);

    // 1. Create a published test business
    const biz = await testApp.createTestBusiness({
      slug: testBizSlug,
      name: 'Saved QA Enterprise Corp',
      contactEmail: 'contact@saved-qa.io',
      contactPhone: '+91 9123456780',
      city: 'Hyderabad',
      state: 'Telangana',
    });
    testBizId = biz.id;

    // 2. Register test user
    const regRes = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: testUserEmail,
        password: testUserPassword,
        firstName: 'Saved',
        lastName: 'Tester',
      });
    const regData = regRes.body.data || regRes.body;
    userId = regData.user.id;
    userToken = regData.tokens.accessToken;
  });

  afterAll(async () => {
    await testApp.cleanupUsers([testUserEmail]);
    await testApp.cleanupBusinesses([testBizSlug]);
    await testApp.close();
  });

  describe('1. Saved Leads CRUD Workflow', () => {
    let savedLeadId: string;

    it('POST /api/v1/saved-leads -> should save a business lead to user pipeline', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/saved-leads')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          businessId: testBizId,
          notes: 'High potential Q4 lead',
          pipelineStage: 'NEW',
          tags: ['Enterprise', 'Tech'],
        });

      expect(res.status).toBe(201);
      const data = res.body.data || res.body;
      expect(data).toHaveProperty('id');
      expect(data.businessId).toBe(testBizId);
      expect(data.pipelineStage).toBe('NEW');
      expect(data.notes).toBe('High potential Q4 lead');
      savedLeadId = data.id;
    });

    it('GET /api/v1/saved-leads -> should list saved leads for the user', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/saved-leads')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      const data = res.body.data || res.body;
      const items = Array.isArray(data) ? data : data.items;
      expect(Array.isArray(items)).toBe(true);
      expect(items.length).toBeGreaterThanOrEqual(1);

      const found = items.find((item: any) => item.id === savedLeadId || item.businessId === testBizId);
      expect(found).toBeDefined();
    });

    it('PATCH /api/v1/saved-leads/:id -> should update stage and notes of saved lead', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/saved-leads/${savedLeadId}`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          pipelineStage: 'CONTACTED',
          notes: 'Called CTO and sent enterprise deck',
        });

      expect(res.status).toBe(200);
      const data = res.body.data || res.body;
      expect(data.pipelineStage).toBe('CONTACTED');
      expect(data.notes).toBe('Called CTO and sent enterprise deck');
    });

    it('DELETE /api/v1/saved-leads/:id -> should remove the saved lead from pipeline', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/saved-leads/${savedLeadId}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);

      // Verify lead is no longer in list
      const listRes = await request(app.getHttpServer())
        .get('/api/v1/saved-leads')
        .set('Authorization', `Bearer ${userToken}`);

      const listData = listRes.body.data || listRes.body;
      const items = Array.isArray(listData) ? listData : listData.items;
      const found = items.find((item: any) => item.id === savedLeadId);
      expect(found).toBeUndefined();
    });
  });

  describe('2. Saved Searches CRUD Workflow', () => {
    let savedSearchId: string;

    it('POST /api/v1/saved-searches -> should create a new saved search', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/saved-searches')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          name: 'Hyderabad Tech Businesses',
          filters: { city: 'Hyderabad', state: 'Telangana' },
          alertEnabled: true,
          alertFrequency: 'DAILY',
        });

      expect(res.status).toBe(201);
      const data = res.body.data || res.body;
      expect(data).toHaveProperty('id');
      expect(data.name).toBe('Hyderabad Tech Businesses');
      expect(data.alertEnabled).toBe(true);
      savedSearchId = data.id;
    });

    it('GET /api/v1/saved-searches -> should list all saved searches for user', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/saved-searches')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      const data = res.body.data || res.body;
      const items = Array.isArray(data) ? data : data.items;
      expect(Array.isArray(items)).toBe(true);
      expect(items.length).toBeGreaterThanOrEqual(1);

      const found = items.find((item: any) => item.id === savedSearchId);
      expect(found).toBeDefined();
    });

    it('GET /api/v1/saved-searches/:id -> should retrieve saved search details', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/saved-searches/${savedSearchId}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      const data = res.body.data || res.body;
      expect(data.id).toBe(savedSearchId);
      expect(data.name).toBe('Hyderabad Tech Businesses');
    });

    it('PATCH /api/v1/saved-searches/:id -> should update saved search title', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/saved-searches/${savedSearchId}`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          name: 'Telangana Tech Giants',
        });

      expect(res.status).toBe(200);
      const data = res.body.data || res.body;
      expect(data.name).toBe('Telangana Tech Giants');
    });

    it('DELETE /api/v1/saved-searches/:id -> should delete the saved search', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/saved-searches/${savedSearchId}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
    });
  });

  describe('3. Security & Authentication Guard Enforcement', () => {
    it('GET /api/v1/saved-leads -> should reject unauthenticated requests with 401', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/saved-leads');
      expect(res.status).toBe(401);
    });

    it('GET /api/v1/saved-searches -> should reject unauthenticated requests with 401', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/saved-searches');
      expect(res.status).toBe(401);
    });
  });
});
