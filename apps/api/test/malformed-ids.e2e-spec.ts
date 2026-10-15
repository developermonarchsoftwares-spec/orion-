import supertest from 'supertest';
const request = (supertest as any).default || supertest;
import { INestApplication } from '@nestjs/common';
import { TestAppHelper } from './helpers/test-app.helper';

/**
 * Regression: an id that is not a UUID must be answered with a client error (400/404), never a 500 from the database.
 * A 500 here leaks that the value reached SQL and is noise in error tracking.
 */
describe('malformed ids are client errors', () => {
  let testApp: TestAppHelper;
  let app: INestApplication;
  let token: string;
  const email = 'malformed.ids@orion.ai';
  const BAD = 'not-a-uuid';

  beforeAll(async () => {
    testApp = new TestAppHelper();
    app = await testApp.init();
    await testApp.cleanupUsers([email]);
    const r = await request(app.getHttpServer()).post('/api/v1/auth/register').send({ email, password: 'Password123!', firstName: 'Mal', lastName: 'Formed' });
    token = r.body.data.tokens.accessToken;
  });
  afterAll(async () => {
    await testApp.cleanupUsers([email]);
    await testApp.close();
  });

  const routes: Array<[string, string]> = [
    ['get', `/api/v1/integrations/${BAD}`],
    ['patch', `/api/v1/integrations/${BAD}`],
    ['delete', `/api/v1/integrations/${BAD}`],
    ['post', `/api/v1/integrations/${BAD}/rotate-secret`],
    ['post', `/api/v1/integrations/${BAD}/test`],
    ['get', `/api/v1/integrations/${BAD}/deliveries`],
    ['post', `/api/v1/integrations/${BAD}/sync`],
    ['get', `/api/v1/exports/${BAD}/download`],
    ['patch', `/api/v1/saved-leads/${BAD}`],
    ['delete', `/api/v1/saved-leads/${BAD}`],
    ['get', `/api/v1/saved-searches/${BAD}`],
    ['patch', `/api/v1/saved-searches/${BAD}`],
    ['delete', `/api/v1/saved-searches/${BAD}`],
    ['post', `/api/v1/saved-searches/${BAD}/run`],
    ['delete', `/api/v1/settings/api-keys/${BAD}`],
    ['get', `/api/v1/businesses/${BAD}`],
    ['get', `/api/v1/discover/businesses/${BAD}`],
  ];

  it.each(routes)('%s %s', async (method, url) => {
    const res = await (request(app.getHttpServer()) as any)[method](url).set('Authorization', `Bearer ${token}`).send({});
    expect(res.status).toBeLessThan(500);
  });
});
