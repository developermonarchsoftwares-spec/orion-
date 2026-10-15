import * as fs from 'fs';
import * as path from 'path';

const repoRoot = path.resolve(__dirname, '../../../../..');

describe('release configuration carries no secret defaults', () => {
  const compose = fs.readFileSync(path.join(repoRoot, 'docker-compose.yml'), 'utf8');
  const secretKey = /^\s*([A-Z0-9_]*(PASSWORD|SECRET|API_KEY|TOKEN)[A-Z0-9_]*)\s*:\s*(.+?)\s*$/gm;

  it('docker-compose.yml takes every password, secret and key from the environment, and refuses to start without it', () => {
    const entries = [...compose.matchAll(secretKey)].map((m) => ({ key: m[1], value: m[3] }));
    expect(entries.length).toBeGreaterThan(0);
    const literal = entries.filter((e) => !/\$\{[A-Z0-9_]+:\?/.test(e.value)).map((e) => e.key);
    expect(literal).toEqual([]);
  });

  it('the database URL in docker-compose.yml embeds no literal password', () => {
    const urls = [...compose.matchAll(/^\s*DATABASE_URL\s*:\s*(.+)$/gm)].map((m) => m[1]);
    for (const u of urls) expect(u).toMatch(/:\$\{POSTGRES_PASSWORD:\?/);
  });

  it('no JWT-like or long base64 secret literal remains in docker-compose.yml', () => {
    expect(compose).not.toMatch(/[A-Za-z0-9+/]{60,}={0,2}/);
    expect(compose).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\./);
  });

  it('the compose example lists the required names and no values', () => {
    const example = fs.readFileSync(path.join(repoRoot, '.env.docker.example'), 'utf8');
    for (const name of ['POSTGRES_PASSWORD', 'MINIO_ROOT_PASSWORD', 'TYPESENSE_API_KEY', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
      expect(example).toMatch(new RegExp(`^${name}=$`, 'm'));
    }
  });
});
