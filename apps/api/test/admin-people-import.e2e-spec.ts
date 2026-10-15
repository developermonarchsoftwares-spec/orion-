import supertest from 'supertest';
const request = (supertest as any).default || supertest;
import { INestApplication } from '@nestjs/common';
import { TestAppHelper } from './helpers/test-app.helper';
import { exportRow, toCsv } from '../src/modules/people/__tests__/people-export-fixtures';

/** Phase 8A: the real application wiring (AppModule, global guards, interceptors) serves POST /admin/people/import to admins only. */
describe('Phase 8A: admin People export import (full application)', () => {
  let testApp: TestAppHelper;
  let app: INestApplication;
  const ADMIN = 'people.import.admin@monarchsoftwares.com';
  const CUSTOMER = 'people.import.customer@test.dev';
  const URL = '/api/v1/admin/people/import';
  const body = { format: 'csv', content: toCsv([exportRow({ company_name: 'Nobody Pvt Ltd', company_city: 'Pune', company_state: 'Maharashtra' })]), dryRun: true };
  const data = (res: any) => res.body.data ?? res.body;
  let adminToken: string;
  let customerToken: string;

  beforeAll(async () => {
    testApp = new TestAppHelper();
    app = await testApp.init();
    await testApp.cleanupUsers([ADMIN, CUSTOMER]);
    await testApp.provisionAdmin(ADMIN, 'ADMIN');
    await request(app.getHttpServer()).post('/api/v1/admin/auth/send-otp').send({ email: ADMIN });
    const verified = await request(app.getHttpServer()).post('/api/v1/admin/auth/verify-otp').send({ email: ADMIN, otp: '123456' });
    adminToken = data(verified).adminToken;
    const reg = await request(app.getHttpServer()).post('/api/v1/auth/register').send({ email: CUSTOMER, password: 'Password123!', firstName: 'Plain', lastName: 'Customer' });
    customerToken = data(reg).tokens.accessToken;
  });
  afterAll(async () => {
    await testApp.cleanupUsers([ADMIN, CUSTOMER]);
    await testApp.close();
  });

  it('anonymous requests are refused with 401', async () => {
    expect((await request(app.getHttpServer()).post(URL).send(body)).status).toBe(401);
  });

  it('an ordinary customer token is refused with 403', async () => {
    expect((await request(app.getHttpServer()).post(URL).set('Authorization', `Bearer ${customerToken}`).send(body)).status).toBe(403);
  });

  it('an administrator reaches the endpoint: a bad file is a 400 before anything is staged or queued', async () => {
    const res = await request(app.getHttpServer()).post(URL).set('Authorization', `Bearer ${adminToken}`).send({ format: 'csv', content: 'not,an,export\r\n1,2,3\r\n' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('MISSING_COLUMNS');
  });

  it('the job status route is admin-only, rejects a malformed id, and 404s an unknown job', async () => {
    const unknown = `${URL}/00000000-0000-4000-8000-000000000000`;
    expect((await request(app.getHttpServer()).get(unknown)).status).toBe(401);
    expect((await request(app.getHttpServer()).get(unknown).set('Authorization', `Bearer ${customerToken}`)).status).toBe(403);
    expect((await request(app.getHttpServer()).get(`${URL}/not-a-uuid`).set('Authorization', `Bearer ${adminToken}`)).status).toBe(400);
    expect((await request(app.getHttpServer()).get(unknown).set('Authorization', `Bearer ${adminToken}`)).status).toBe(404);
  });
});
