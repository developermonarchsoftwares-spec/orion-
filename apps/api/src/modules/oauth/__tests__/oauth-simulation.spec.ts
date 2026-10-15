import { ConfigService } from '@nestjs/config';
import { GoogleOAuthProvider } from '../providers/google.provider';
import { MicrosoftOAuthProvider } from '../providers/microsoft.provider';
import { oauthSimulationAllowed } from '../oauth-simulation';

const LOCAL_DB = 'postgresql://localhost:5432/orion_db';
const REMOTE_DB = 'postgresql://db.example.org:5432/orion_db';

const config = (values: Record<string, string>) => ({ get: (key: string) => values[key] }) as unknown as ConfigService;
const CONFIGURED = {
  GOOGLE_CLIENT_ID: 'client-id-for-unit-test',
  GOOGLE_CLIENT_SECRET: 'client-secret-for-unit-test',
  MICROSOFT_CLIENT_ID: 'client-id-for-unit-test',
  MICROSOFT_CLIENT_SECRET: 'client-secret-for-unit-test',
};

describe('simulated OAuth sign-in is test-only', () => {
  const saved = { NODE_ENV: process.env.NODE_ENV, DATABASE_URL: process.env.DATABASE_URL };
  const setEnv = (nodeEnv: string, db: string) => {
    (process.env as Record<string, string>).NODE_ENV = nodeEnv;
    process.env.DATABASE_URL = db;
  };
  afterEach(() => {
    (process.env as Record<string, string | undefined>).NODE_ENV = saved.NODE_ENV;
    if (saved.DATABASE_URL === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved.DATABASE_URL;
  });

  it('is allowed only for NODE_ENV=test with a local database', () => {
    expect(oauthSimulationAllowed({ NODE_ENV: 'test', DATABASE_URL: LOCAL_DB } as NodeJS.ProcessEnv)).toBe(true);
    expect(oauthSimulationAllowed({ NODE_ENV: 'test', DATABASE_URL: REMOTE_DB } as NodeJS.ProcessEnv)).toBe(false);
    expect(oauthSimulationAllowed({ NODE_ENV: 'test' } as NodeJS.ProcessEnv)).toBe(false);
    for (const env of ['production', 'development', 'staging', undefined]) {
      expect(oauthSimulationAllowed({ NODE_ENV: env, DATABASE_URL: LOCAL_DB } as NodeJS.ProcessEnv)).toBe(false);
    }
  });

  describe.each([
    ['google', () => new GoogleOAuthProvider(config(CONFIGURED)), () => new GoogleOAuthProvider(config({})), 'sim_google_', 'google_sim_access_'],
    ['microsoft', () => new MicrosoftOAuthProvider(config(CONFIGURED)), () => new MicrosoftOAuthProvider(config({})), 'sim_ms_', 'ms_sim_access_'],
  ])('%s provider', (_name, configured, unconfigured, codePrefix, tokenPrefix) => {
    it.each(['production', 'development'])('rejects a simulation code when configured (%s)', async (nodeEnv) => {
      setEnv(nodeEnv, LOCAL_DB);
      await expect(configured().exchangeCode(`${codePrefix}victim@example.org`)).rejects.toMatchObject({ response: expect.anything() });
    });

    it.each(['production', 'development'])('refuses an unconfigured provider instead of simulating (%s)', async (nodeEnv) => {
      setEnv(nodeEnv, LOCAL_DB);
      await expect(unconfigured().exchangeCode('any-code')).rejects.toBeDefined();
      await expect(unconfigured().exchangeCode(`${codePrefix}victim@example.org`)).rejects.toBeDefined();
    });

    it('refuses a simulation code under test when the database is remote', async () => {
      setEnv('test', REMOTE_DB);
      await expect(configured().exchangeCode(`${codePrefix}victim@example.org`)).rejects.toBeDefined();
    });

    it('never turns a simulated access token into a profile outside the test environment', async () => {
      setEnv('production', LOCAL_DB);
      await expect(configured().getUserProfile(`${tokenPrefix}victim@example.org`)).rejects.toBeDefined();
    });

    it('still simulates under test with a local database (keeps local fixtures working)', async () => {
      setEnv('test', LOCAL_DB);
      const provider = configured();
      const tokens = await provider.exchangeCode(`${codePrefix}someone@example.org`);
      const profile = await provider.getUserProfile(tokens.accessToken);
      expect(profile.email).toBe('someone@example.org');
    });
  });
});
