import * as Joi from 'joi';
import { DEV_CORS_ORIGINS, parseCorsOrigins } from '../cors';
import { environmentValidationSchema } from '../env.validation';

describe('CORS origins (Phase 14)', () => {
  it('development: the local web app by default; production: nothing by default', () => {
    expect(parseCorsOrigins(undefined, false).origins).toEqual(DEV_CORS_ORIGINS);
    expect(parseCorsOrigins('', false).origins).toEqual(DEV_CORS_ORIGINS);
    expect(parseCorsOrigins(undefined, true)).toEqual({ origins: [], problems: [] });
    expect(parseCorsOrigins('  ', true).origins).toEqual([]);
  });

  it('production accepts exact https origins, normalises a trailing slash and removes duplicates', () => {
    const r = parseCorsOrigins('https://app.orion-test.example, https://app.orion-test.example/, https://admin.orion-test.example:8443', true);
    expect(r.problems).toEqual([]);
    expect(r.origins).toEqual(['https://app.orion-test.example', 'https://admin.orion-test.example:8443']);
  });

  it.each([
    ['*', 'wildcard'],
    ['https://*.orion-test.example', 'wildcard'],
    ['http://app.orion-test.example', 'not https'],
    ['https://localhost:3000', 'local address'],
    ['https://127.0.0.1', 'local address'],
    ['https://dev.localhost', 'local address'],
    ['https://app.orion-test.example/path', 'exact origin'],
    ['https://user:pw@app.orion-test.example', 'exact origin'],
    ['not a url', 'not a valid origin'],
  ])('production refuses %s', (value, why) => {
    const r = parseCorsOrigins(value, true);
    expect(r.origins).toEqual([]);
    expect(r.problems.join(' ')).toContain(why);
  });

  it('a wildcard is refused outside production too (credentials are always on)', () => {
    expect(parseCorsOrigins('*', false).problems.length).toBe(1);
    expect(parseCorsOrigins('*', false).origins).toEqual([]);
  });

  it('startup validation: production refuses an unsafe CORS_ORIGINS and accepts a safe one or none; development keeps its default', () => {
    const base = { DATABASE_URL: 'postgresql://u:p@db.example.com:5432/orion', JWT_ACCESS_SECRET: 'a-long-random-access-secret-value-1234', JWT_REFRESH_SECRET: 'a-long-random-refresh-secret-value-5678' };
    const check = (env: Record<string, string>) => (environmentValidationSchema as Joi.ObjectSchema).validate({ NODE_ENV: 'production', ...base, ...env }, { allowUnknown: true });
    expect(check({ CORS_ORIGINS: '*' }).error?.message).toMatch(/CORS_ORIGINS is unsafe for production/);
    expect(check({ CORS_ORIGINS: 'http://localhost:3000' }).error?.message).toMatch(/CORS_ORIGINS is unsafe for production/);
    expect(check({ CORS_ORIGINS: 'https://app.orion-test.example' }).error?.message ?? '').not.toMatch(/CORS_ORIGINS/);
    expect(check({}).error?.message ?? '').not.toMatch(/CORS_ORIGINS/);
    const dev = (environmentValidationSchema as Joi.ObjectSchema).validate({ NODE_ENV: 'development' }, { allowUnknown: true });
    expect(dev.value.CORS_ORIGINS).toBe('http://localhost:3000,http://127.0.0.1:3000');
  });
});
