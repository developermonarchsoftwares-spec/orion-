import * as net from 'net';
import { AddressInfo } from 'net';
import { probeRedis, redisConfig } from '../redis-probe';

/** Decodes the RESP arrays a client sends: one command per array of bulk strings. */
function* commandsOf(buf: Buffer): Generator<string[]> {
  let i = 0;
  const s = buf.toString('utf8');
  while (i < s.length && s[i] === '*') {
    const eol = s.indexOf('\r\n', i);
    const n = Number(s.slice(i + 1, eol));
    i = eol + 2;
    const parts: string[] = [];
    for (let k = 0; k < n; k++) {
      const e2 = s.indexOf('\r\n', i);
      const len = Number(s.slice(i + 1, e2));
      parts.push(s.slice(e2 + 2, e2 + 2 + len));
      i = e2 + 2 + len + 2;
    }
    yield parts;
  }
}

interface IFake {
  port: number;
  commands: string[][];
  close: () => Promise<void>;
}

/** A tiny fake Redis. `behaviour` decides each reply; the default is a well-behaved server. */
async function fakeRedis(opts: { password?: string; username?: string; dbs?: number; infoError?: boolean; garbage?: boolean; silent?: boolean; dribble?: boolean; hangUp?: boolean } = {}): Promise<IFake> {
  const commands: string[][] = [];
  const server = net.createServer((sock) => {
    let authed = !opts.password;
    sock.on('data', (chunk) => {
      if (opts.silent) return;
      if (opts.hangUp) return sock.destroy();
      let out = '';
      for (const cmd of commandsOf(chunk)) {
        commands.push(cmd);
        const name = cmd[0].toUpperCase();
        let reply: string;
        if (opts.garbage) reply = '?what\r\n';
        else if (name === 'AUTH') {
          const given = cmd.length === 3 ? { u: cmd[1], p: cmd[2] } : { u: undefined, p: cmd[1] };
          authed = given.p === opts.password && (opts.username === undefined || given.u === opts.username);
          reply = authed ? '+OK\r\n' : '-WRONGPASS invalid username-password pair or user is disabled.\r\n';
        } else if (!authed) reply = '-NOAUTH Authentication required.\r\n';
        else if (name === 'SELECT') reply = Number(cmd[1]) < (opts.dbs ?? 16) ? '+OK\r\n' : '-ERR DB index is out of range\r\n';
        else if (name === 'PING') reply = '+PONG\r\n';
        else if (name === 'INFO') {
          const body = '# Server\r\nredis_version:7.2.4\r\nredis_mode:standalone\r\n';
          reply = opts.infoError ? '-NOPERM this user has no permissions to run the info command\r\n' : `$${Buffer.byteLength(body)}\r\n${body}\r\n`;
        } else reply = '-ERR unknown command\r\n';
        out += reply;
      }
      // all replies of this batch, in order: at once, or one byte at a time
      if (opts.dribble) [...out].forEach((ch, i) => setTimeout(() => sock.write(ch), i));
      else if (out) sock.write(out);
    });
    sock.on('error', () => undefined);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { port: (server.address() as AddressInfo).port, commands, close: () => new Promise<void>((r) => server.close(() => r())) };
}

const cfg = (port: number, over: object = {}) => ({ host: '127.0.0.1', port, tls: false, db: 0, ...over });

describe('redisConfig', () => {
  it('reads a URL (scheme, credentials, database) or the REDIS_* variables, and is null when nothing is configured', () => {
    expect(redisConfig({ REDIS_URL: 'redis://:s3cret@cache.internal:6380/2' } as any)).toEqual({ host: 'cache.internal', port: 6380, tls: false, username: undefined, password: 's3cret', db: 2 });
    expect(redisConfig({ REDIS_URL: 'rediss://app:p%40ss@cache.example.com' } as any)).toEqual({ host: 'cache.example.com', port: 6379, tls: true, username: 'app', password: 'p@ss', db: 0 });
    expect(redisConfig({ REDIS_URL: 'http://wrong' } as any)).toBeNull();
    expect(redisConfig({ REDIS_URL: 'not a url' } as any)).toBeNull();
    expect(redisConfig({ REDIS_HOST: 'h', REDIS_PORT: '6400', REDIS_PASSWORD: 'pw', REDIS_DB: '4', REDIS_TLS: 'true', REDIS_USERNAME: 'u' } as any)).toEqual({ host: 'h', port: 6400, tls: true, username: 'u', password: 'pw', db: 4 });
    expect(redisConfig({ REDIS_HOST: 'h' } as any)).toMatchObject({ port: 6379, tls: false, db: 0, password: undefined });
    // the empty placeholders in the deployment env files mean "not configured"
    expect(redisConfig({ REDIS_HOST: '', REDIS_PORT: '', REDIS_PASSWORD: '', REDIS_DB: '', REDIS_TLS: '' } as any)).toBeNull();
    expect(redisConfig({} as any)).toBeNull();
    expect(redisConfig({ REDIS_URL: 'redis://h:1/-3' } as any)).toMatchObject({ db: 0 });
  });
});

describe('probeRedis', () => {
  const servers: IFake[] = [];
  const start = async (o?: Parameters<typeof fakeRedis>[0]) => {
    const f = await fakeRedis(o);
    servers.push(f);
    return f;
  };
  afterAll(async () => {
    await Promise.all(servers.map((s) => s.close()));
  });

  it('pings an open server and reads its version, with no AUTH or SELECT when none is configured', async () => {
    const f = await start();
    const r = await probeRedis(cfg(f.port), 2000);
    expect(r).toMatchObject({ ok: true, version: '7.2.4', role: 'standalone' });
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
    expect(f.commands.map((c) => c[0])).toEqual(['PING', 'INFO']);
  });

  it('authenticates (password, or user and password) and selects the database, in that order', async () => {
    const f = await start({ password: 'pw1', dbs: 8 });
    expect((await probeRedis(cfg(f.port, { password: 'pw1', db: 3 }), 2000)).ok).toBe(true);
    expect(f.commands.slice(0, 4)).toEqual([['AUTH', 'pw1'], ['SELECT', '3'], ['PING'], ['INFO', 'server']]);
    const g = await start({ password: 'pw2', username: 'app' });
    expect((await probeRedis(cfg(g.port, { password: 'pw2', username: 'app' }), 2000)).ok).toBe(true);
    expect(g.commands[0]).toEqual(['AUTH', 'app', 'pw2']);
  });

  it('reports a wrong password, a missing password and a bad database as fixed failure codes', async () => {
    const f = await start({ password: 'right', dbs: 4 });
    expect(await probeRedis(cfg(f.port, { password: 'wrong' }), 2000)).toMatchObject({ ok: false, reason: 'auth_failed' });
    expect(await probeRedis(cfg(f.port), 2000)).toMatchObject({ ok: false, reason: 'auth_failed' }); // server wants a password, none configured
    expect(await probeRedis(cfg(f.port, { password: 'right', db: 9 }), 2000)).toMatchObject({ ok: false, reason: 'protocol_error' });
  });

  it('still counts as up when INFO is not allowed for the account (the PING already proved it)', async () => {
    const f = await start({ infoError: true });
    const r = await probeRedis(cfg(f.port), 2000);
    expect(r.ok).toBe(true);
    expect(r.version).toBeUndefined();
  });

  it('copes with a reply that arrives one byte at a time', async () => {
    const f = await start({ dribble: true });
    expect(await probeRedis(cfg(f.port), 3000)).toMatchObject({ ok: true, version: '7.2.4' });
  });

  it('classifies a refused connection, a silent server, a server that hangs up and a server that is not Redis', async () => {
    const closed = await fakeRedis();
    const port = closed.port;
    await closed.close();
    expect(await probeRedis(cfg(port), 1000)).toMatchObject({ ok: false, reason: 'connection_refused' });

    const silent = await start({ silent: true });
    const t0 = Date.now();
    expect(await probeRedis(cfg(silent.port), 300)).toMatchObject({ ok: false, reason: 'timeout' });
    expect(Date.now() - t0).toBeLessThan(1500);

    const hangup = await start({ hangUp: true });
    expect((await probeRedis(cfg(hangup.port), 1000)).ok).toBe(false);

    const garbage = await start({ garbage: true });
    expect(await probeRedis(cfg(garbage.port), 1000)).toMatchObject({ ok: false, reason: 'protocol_error' });
  });

  it('never puts the host, the user or the password into a result', async () => {
    const f = await start({ password: 'right' });
    const out = JSON.stringify([await probeRedis(cfg(f.port, { password: 'super-secret-pw', username: 'svc-user' }), 1000), await probeRedis({ host: 'redis.internal.example', port: 1, tls: false, db: 0, password: 'super-secret-pw' }, 800)]);
    expect(out).not.toMatch(/super-secret-pw|svc-user|redis\.internal\.example|127\.0\.0\.1/);
  });
});
