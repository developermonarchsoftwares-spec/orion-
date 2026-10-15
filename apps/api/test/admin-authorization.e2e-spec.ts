import supertest from 'supertest';
const request = (supertest as any).default || supertest;
import { INestApplication } from '@nestjs/common';
import { TestAppHelper } from './helpers/test-app.helper';
import * as schema from '../src/database/schema';

/** Administrative access is a persisted role (ADMIN / SUPER_ADMIN, ACTIVE), never an email domain or a token claim. */
describe('Phase 6.19: admin authorization uses persisted roles', () => {
  let testApp: TestAppHelper;
  let app: INestApplication;
  const NOT_PROVISIONED = 'unprovisioned@monarchsoftwares.com';
  const PLAIN_USER = 'plain.user@monarchsoftwares.com';
  const SUSPENDED = 'suspended.admin@monarchsoftwares.com';
  const LIMITED = 'limited.admin@monarchsoftwares.com';
  const EMAILS = [NOT_PROVISIONED, PLAIN_USER, SUSPENDED, LIMITED, 'plain.customer.adm@test.dev'];

  const send = (email: string) => request(app.getHttpServer()).post('/api/v1/admin/auth/send-otp').send({ email });
  const verify = (email: string) => request(app.getHttpServer()).post('/api/v1/admin/auth/verify-otp').send({ email, otp: '123456' });
  const adminRoute = (token?: string) => {
    const r = request(app.getHttpServer()).post('/api/v1/admin/import/preview');
    return (token ? r.set('Authorization', `Bearer ${token}`) : r).send({ rows: [] });
  };
  const body = (res: any) => res.body.data ?? res.body;

  beforeAll(async () => {
    testApp = new TestAppHelper();
    app = await testApp.init();
    await testApp.cleanupUsers(EMAILS);
  });
  afterAll(async () => {
    await testApp.cleanupUsers(EMAILS);
    await testApp.close();
  });

  it('a company-domain address with no admin account gets no code and no session, and no account is created', async () => {
    const sent = await send(NOT_PROVISIONED);
    expect(sent.status).toBe(200);
    expect(body(sent).previewOtp).toBeUndefined();
    expect((await verify(NOT_PROVISIONED)).status).toBe(400);
    const rows = await testApp.db.select().from(schema.users);
    expect(rows.some((u: any) => u.email === NOT_PROVISIONED)).toBe(false);
  });

  it('a company-domain address that belongs to an ordinary USER cannot become an administrator', async () => {
    await testApp.provisionAdmin(PLAIN_USER, 'USER');
    expect(body(await send(PLAIN_USER)).previewOtp).toBeUndefined();
    expect((await verify(PLAIN_USER)).status).toBe(400);
  });

  it('a suspended administrator cannot sign in', async () => {
    await testApp.provisionAdmin(SUSPENDED, 'ADMIN', 'SUSPENDED');
    expect((await verify(SUSPENDED)).status).toBe(400);
  });

  it('the session carries the persisted role, works on admin routes, and dies when the role is revoked or the account suspended', async () => {
    await testApp.provisionAdmin(LIMITED, 'ADMIN', 'ACTIVE');
    expect(body(await send(LIMITED)).previewOtp).toBe('123456');
    const res = await verify(LIMITED);
    expect(res.status).toBe(200);
    expect(body(res).user.role).toBe('ADMIN'); // not escalated to SUPER_ADMIN
    const token = body(res).adminToken;
    expect((await adminRoute(token)).status).not.toBe(403);

    await testApp.provisionAdmin(LIMITED, 'USER', 'ACTIVE'); // demoted: the unexpired token no longer works
    expect((await adminRoute(token)).status).toBe(403);
    await testApp.provisionAdmin(LIMITED, 'ADMIN', 'SUSPENDED');
    // S-08: a suspended account is denied. The session is revoked at the auth layer (401), which
    // supersedes the role gate (403); either is a valid "access denied".
    expect([401, 403]).toContain((await adminRoute(token)).status);
  });

  it('anonymous and ordinary-customer tokens are refused on admin routes', async () => {
    expect((await adminRoute()).status).toBe(401);
    const reg = await request(app.getHttpServer()).post('/api/v1/auth/register').send({ email: 'plain.customer.adm@test.dev', password: 'Password123!', firstName: 'P', lastName: 'C' });
    expect((await adminRoute(body(reg).tokens.accessToken)).status).toBe(403);
  });
});
