import * as fs from 'fs';
import * as path from 'path';
import { isLocalDatabaseUrl, verifiedConnection } from '../tls';

describe('verified database TLS', () => {
  const remote = 'postgresql://user:pw@ep-example.c-2.us-east-2.aws.neon.tech/db';

  it('verifies the server certificate for a remote database', () => {
    expect(verifiedConnection(remote).ssl).toEqual({ rejectUnauthorized: true });
  });

  it.each(['sslmode=no-verify', 'sslmode=disable', 'sslmode=require&uselibpqcompat=true', 'ssl=false'])(
    'a connection-string setting (%s) cannot weaken or disable verification',
    (qs) => {
      const c = verifiedConnection(`${remote}?${qs}&application_name=x`);
      expect(c.ssl).toEqual({ rejectUnauthorized: true });
      expect(c.connectionString).not.toMatch(/sslmode|uselibpqcompat|ssl=/);
      expect(c.connectionString).toContain('application_name=x');
    },
  );

  it('only a local database may run without TLS', () => {
    for (const u of ['postgresql://u:p@localhost:5432/d', 'postgresql://u:p@127.0.0.1:5433/d', 'postgresql://u:p@[::1]:5432/d', 'postgresql://u:p@db.localhost/d']) {
      expect(isLocalDatabaseUrl(u)).toBe(true);
      expect(verifiedConnection(u).ssl).toBe(false);
    }
    for (const u of [remote, 'postgresql://u:p@localhost.evil.com/d', 'postgresql://u:p@10.0.0.5/d', 'not a url', undefined]) {
      expect(isLocalDatabaseUrl(u as string)).toBe(false);
    }
  });

  it('keeps TLS verified when the URL cannot be parsed (the driver rejects it)', () => {
    expect(verifiedConnection('not a url').ssl).toEqual({ rejectUnauthorized: true });
  });

  it('no API source or maintenance script disables certificate verification', () => {
    const roots = [path.resolve(__dirname, '../..'), path.resolve(__dirname, '../../../scripts')];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name !== 'node_modules' && e.name !== '__tests__') walk(p);
        } else if (/\.ts$/.test(e.name) && !/\.spec\.ts$/.test(e.name) && /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED/.test(fs.readFileSync(p, 'utf8'))) {
          offenders.push(path.relative(path.resolve(__dirname, '../../..'), p));
        }
      }
    };
    roots.forEach(walk);
    expect(offenders).toEqual([]);
  });
});
