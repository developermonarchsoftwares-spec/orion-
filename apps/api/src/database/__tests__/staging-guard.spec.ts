import * as fs from 'fs';
import * as path from 'path';
import { assertMigratedBranch, assertStagingTarget, hostOf } from '../staging-guard';

const PROD = ['ep-prod-example-pooler.c-2.us-east-2.aws.neon.tech'];
const branch = 'postgresql://user:secretpw@ep-branch-example.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require';

describe('staging guard (fails closed)', () => {
  it('needs STAGING_DATABASE_URL: a production DATABASE_URL in the environment is never used', () => {
    expect(() => assertStagingTarget({ DATABASE_URL: branch } as any, PROD)).toThrow(/STAGING_DATABASE_URL is not set/);
  });
  it('needs explicit host confirmation that matches exactly', () => {
    expect(() => assertStagingTarget({ STAGING_DATABASE_URL: branch } as any, PROD)).toThrow(/STAGING_CONFIRM_HOST/);
    expect(() => assertStagingTarget({ STAGING_DATABASE_URL: branch, STAGING_CONFIRM_HOST: 'ep-other.c-2.us-east-2.aws.neon.tech' } as any, PROD)).toThrow(/STAGING_CONFIRM_HOST/);
  });
  it('refuses the production host in pooler or direct form, and anything in STAGING_FORBIDDEN_HOSTS', () => {
    for (const h of ['ep-prod-example-pooler.c-2.us-east-2.aws.neon.tech', 'ep-prod-example.c-2.us-east-2.aws.neon.tech']) {
      const url = `postgresql://u:p@${h}/neondb`;
      expect(() => assertStagingTarget({ STAGING_DATABASE_URL: url, STAGING_CONFIRM_HOST: h } as any, PROD)).toThrow(/production host/);
    }
    expect(() => assertStagingTarget({ STAGING_DATABASE_URL: branch, STAGING_CONFIRM_HOST: 'ep-branch-example.c-2.us-east-2.aws.neon.tech', STAGING_FORBIDDEN_HOSTS: 'ep-branch-example.c-2.us-east-2.aws.neon.tech' } as any, PROD)).toThrow(/production host/);
  });
  it('cannot prove isolation without a known production host, and rejects local databases', () => {
    expect(() => assertStagingTarget({ STAGING_DATABASE_URL: branch, STAGING_CONFIRM_HOST: 'ep-branch-example.c-2.us-east-2.aws.neon.tech' } as any, [])).toThrow(/isolation cannot be proven/);
    expect(() => assertStagingTarget({ STAGING_DATABASE_URL: 'postgresql://a:b@localhost/x', STAGING_CONFIRM_HOST: 'localhost' } as any, PROD)).toThrow(/not a local database/);
  });
  it('accepts a different, confirmed host and reports host and database only (never credentials)', () => {
    const t = assertStagingTarget({ STAGING_DATABASE_URL: branch, STAGING_CONFIRM_HOST: 'EP-BRANCH-EXAMPLE.c-2.us-east-2.aws.neon.tech' } as any, PROD);
    expect(t).toEqual({ host: 'ep-branch-example.c-2.us-east-2.aws.neon.tech', database: 'neondb' });
    expect(JSON.stringify(t)).not.toContain('secretpw');
    for (const bad of [{ STAGING_DATABASE_URL: 'nope' }]) {
      try {
        assertStagingTarget(bad as any, PROD);
      } catch (e: any) {
        expect(e.message).not.toContain('nope:');
      }
    }
    expect(hostOf(branch)).toBe('ep-branch-example.c-2.us-east-2.aws.neon.tech');
  });
  it('positive proof: only a database with the complete migration history is accepted', () => {
    expect(() => assertMigratedBranch(3, 18)).toThrow(/may not be the rehearsal branch/); // production today
    expect(() => assertMigratedBranch(18, 18)).not.toThrow();
  });
  it('the staging setup never reads DATABASE_URL from the environment or .env as a target', () => {
    const setup = fs.readFileSync(path.resolve(__dirname, '../../../test/setup-staging-env.ts'), 'utf8');
    expect(setup).toContain('assertStagingTarget(process.env, productionHosts)');
    expect(setup).not.toMatch(/process\.env\.DATABASE_URL\s*(\|\||\?\?)/);
    expect(setup).toMatch(/SEARCH_PROVIDER = 'postgres'/);
    expect(setup).toMatch(/STORAGE_PROVIDER = 'local'/);
    expect(setup).toMatch(/'RESEND_API_KEY'/);
  });
});
