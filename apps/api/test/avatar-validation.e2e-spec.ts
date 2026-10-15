import supertest from 'supertest';
const request = (supertest as any).default || supertest;
import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { TestAppHelper } from './helpers/test-app.helper';

/**
 * SG-24 over HTTP (Phase 32). The validator was only tested as a function, so removing either call from the user service
 * would have left every test green. These run the real routes: a refused avatar must answer 400 AND leave the stored value alone.
 */
describe('Avatar validation at the HTTP boundary (SG-24)', () => {
  let testApp: TestAppHelper;
  let app: INestApplication;
  const api = () => request(app.getHttpServer());
  const email = `avatar.${Date.now()}@orion-test.io`;
  let auth: { Authorization: string };
  const GOOD = 'https://images.example.com/me.png';
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const SVG = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxzY3JpcHQ+YWxlcnQoMSk8L3NjcmlwdD48L3N2Zz4=';
  const NOT_PUBLIC = [
    'https://127.0.0.1/a.png', 'https://127.0.0.2/a.png', 'https://[::1]/a.png', 'https://[::ffff:127.0.0.1]/a.png',
    'https://10.0.0.1/a.png', 'https://169.254.169.254/latest', 'https://169.254.1.1/a.png', 'https://100.64.0.1/a.png',
    'https://[fd00::1]/a.png', 'https://[fe80::1]/a.png', 'https://localhost./a.png', 'https://metadata.google.internal/a.png',
    'https://user:pw@images.example.com/a.png',
  ];
  const stored = async () => {
    const res = await api().get('/api/v1/user/profile').set(auth);
    const body = res.body.data || res.body;
    return body.avatarUrl ?? body.profilePicture ?? null;
  };

  beforeAll(async () => {
    testApp = new TestAppHelper();
    app = await testApp.init();
    const created = await api().post('/api/v1/auth/register').send({ email, password: 'ValidPass123!', firstName: 'Av', lastName: 'Atar' });
    const body = created.body.data || created.body;
    auth = { Authorization: `Bearer ${body.tokens.accessToken}` };
  });
  beforeEach(() => {
    (app.get(ThrottlerStorage) as any).storage.clear();
  });
  afterAll(async () => {
    await testApp.cleanupUsers([email]);
    await testApp.close();
  });

  it('anonymous callers cannot set an avatar', async () => {
    expect((await api().post('/api/v1/user/avatar').send({ image: PNG })).status).toBe(401);
  });

  it('a valid data image and a valid public https URL are stored', async () => {
    expect((await api().post('/api/v1/user/avatar').set(auth).send({ image: PNG })).status).toBe(200);
    expect(await stored()).toBe(PNG);
    expect((await api().patch('/api/v1/user/profile').set(auth).send({ avatarUrl: GOOD })).status).toBe(200);
    expect(await stored()).toBe(GOOD);
  });

  it('SVG and script-bearing data URIs are refused on both routes and the stored avatar is unchanged', async () => {
    for (const bad of [SVG, 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==', 'javascript:alert(1)', 'http://images.example.com/a.png']) {
      expect([400, 422]).toContain((await api().post('/api/v1/user/avatar').set(auth).send({ image: bad })).status);
      expect([400, 422]).toContain((await api().patch('/api/v1/user/profile').set(auth).send({ avatarUrl: bad })).status);
    }
    expect(await stored()).toBe(GOOD);
  });

  it.each(NOT_PUBLIC)('a non-public or credentialed avatar URL is refused on both routes: %s', async (bad) => {
    const a = await api().post('/api/v1/user/avatar').set(auth).send({ image: bad });
    const b = await api().patch('/api/v1/user/profile').set(auth).send({ avatarUrl: bad });
    expect({ avatar: a.status, profile: b.status }).toEqual({ avatar: 400, profile: 400 });
    expect(await stored()).toBe(GOOD);
  });

  it('an oversized avatar is refused', async () => {
    const huge = 'data:image/png;base64,' + 'A'.repeat(1_500_100);
    const res = await api().post('/api/v1/user/avatar').set(auth).send({ image: huge });
    expect([400, 413]).toContain(res.status);
    expect(await stored()).toBe(GOOD);
  });
});
