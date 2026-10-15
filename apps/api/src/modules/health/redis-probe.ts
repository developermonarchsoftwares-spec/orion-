import * as net from 'net';
import * as tls from 'tls';
import { performance } from 'perf_hooks';

/**
 * A Redis health probe that needs no client library: it speaks just enough RESP to authenticate, select the database and PING (and to read
 * the server version from INFO). It exists so the platform can monitor a Redis the moment one is configured. NOTE: nothing in the
 * application uses Redis today (the job queue runs on PostgreSQL), so with no Redis configured the check reports "not configured".
 *
 * Configuration (the first one that applies):
 *   REDIS_URL=redis://[user:password@]host[:port][/db]   (rediss:// for TLS)
 *   REDIS_HOST, REDIS_PORT (6379), REDIS_PASSWORD, REDIS_USERNAME, REDIS_DB (0), REDIS_TLS (true|false)
 * The host, user and password never appear in a result or an error.
 */
export interface IRedisConfig {
  host: string;
  port: number;
  tls: boolean;
  username?: string;
  password?: string;
  db: number;
}

const truthy = (v: string | undefined) => ['1', 'true', 'yes', 'on'].includes(String(v ?? '').trim().toLowerCase());

export function redisConfig(env: NodeJS.ProcessEnv = process.env): IRedisConfig | null {
  const url = (env.REDIS_URL ?? '').trim();
  if (url) {
    try {
      const u = new URL(url);
      if (u.protocol !== 'redis:' && u.protocol !== 'rediss:') return null;
      const db = Number((u.pathname || '/').slice(1) || 0);
      return {
        host: u.hostname,
        port: Number(u.port) || 6379,
        tls: u.protocol === 'rediss:',
        username: u.username ? decodeURIComponent(u.username) : undefined,
        password: u.password ? decodeURIComponent(u.password) : undefined,
        db: Number.isInteger(db) && db >= 0 ? db : 0,
      };
    } catch {
      return null;
    }
  }
  const host = (env.REDIS_HOST ?? '').trim();
  if (!host) return null;
  const port = parseInt(env.REDIS_PORT ?? '', 10);
  const db = parseInt(env.REDIS_DB ?? '', 10);
  return { host, port: Number.isInteger(port) && port > 0 ? port : 6379, tls: truthy(env.REDIS_TLS), username: env.REDIS_USERNAME || undefined, password: env.REDIS_PASSWORD || undefined, db: Number.isInteger(db) && db >= 0 ? db : 0 };
}

export type RedisFailure = 'connection_refused' | 'timeout' | 'auth_failed' | 'tls_error' | 'protocol_error' | 'error';

export interface IRedisProbeResult {
  ok: boolean;
  latencyMs: number;
  reason?: RedisFailure;
  version?: string;
  role?: string;
}

type Reply = { kind: '+' | '-' | ':' | '$'; value: string | number | null };

/** Parses one RESP reply from the front of `buf`; returns null when it is incomplete. Arrays are not needed for the commands used. */
function parseReply(buf: Buffer): { reply: Reply; used: number } | null {
  const eol = buf.indexOf('\r\n');
  if (eol === -1) return null;
  const kind = String.fromCharCode(buf[0]);
  const line = buf.subarray(1, eol).toString('utf8');
  if (kind === '+' || kind === '-') return { reply: { kind, value: line }, used: eol + 2 };
  if (kind === ':') return { reply: { kind, value: Number(line) }, used: eol + 2 };
  if (kind === '$') {
    const len = Number(line);
    if (len === -1) return { reply: { kind, value: null }, used: eol + 2 };
    if (buf.length < eol + 2 + len + 2) return null;
    return { reply: { kind, value: buf.subarray(eol + 2, eol + 2 + len).toString('utf8') }, used: eol + 2 + len + 2 };
  }
  throw new Error('unexpected reply type');
}

const encode = (...parts: string[]) => `*${parts.length}\r\n${parts.map((p) => `$${Buffer.byteLength(p)}\r\n${p}\r\n`).join('')}`;

export interface IProbeOptions {
  /** Replaceable in tests. */
  connect?: (cfg: IRedisConfig) => net.Socket;
}

export function probeRedis(cfg: IRedisConfig, timeoutMs = 2000, opts: IProbeOptions = {}): Promise<IRedisProbeResult> {
  const started = performance.now();
  return new Promise((resolve) => {
    let settled = false;
    let socket: net.Socket | undefined;
    let buf = Buffer.alloc(0);
    const commands: Array<{ name: 'AUTH' | 'SELECT' | 'PING' | 'INFO'; raw: string }> = [];
    if (cfg.password) commands.push({ name: 'AUTH', raw: cfg.username ? encode('AUTH', cfg.username, cfg.password) : encode('AUTH', cfg.password) });
    if (cfg.db > 0) commands.push({ name: 'SELECT', raw: encode('SELECT', String(cfg.db)) });
    commands.push({ name: 'PING', raw: encode('PING') });
    commands.push({ name: 'INFO', raw: encode('INFO', 'server') });
    let idx = 0;
    let version: string | undefined;
    let role: string | undefined;
    let pong = false;

    const done = (ok: boolean, reason?: RedisFailure) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket?.destroy();
      resolve({ ok, latencyMs: Math.round((performance.now() - started) * 10) / 10, ...(reason ? { reason } : {}), ...(ok && version ? { version } : {}), ...(ok && role ? { role } : {}) });
    };
    const timer = setTimeout(() => done(false, 'timeout'), timeoutMs);

    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      try {
        for (;;) {
          const r = parseReply(buf);
          if (!r) return;
          buf = buf.subarray(r.used);
          const cmd = commands[idx++];
          if (!cmd) return done(false, 'protocol_error');
          if (r.reply.kind === '-') {
            const msg = String(r.reply.value);
            if (/WRONGPASS|NOAUTH|invalid password|AUTH/i.test(msg) && cmd.name !== 'INFO') return done(false, 'auth_failed');
            if (cmd.name === 'INFO') {
              // INFO may be disabled by the server's ACL: the PING already proved it is up
              return done(pong);
            }
            return done(false, 'protocol_error');
          }
          if (cmd.name === 'PING') pong = r.reply.value === 'PONG';
          if (cmd.name === 'PING' && !pong) return done(false, 'protocol_error');
          if (cmd.name === 'INFO' && typeof r.reply.value === 'string') {
            version = /redis_version:([^\r\n]+)/.exec(r.reply.value)?.[1]?.trim() ?? /valkey_version:([^\r\n]+)/.exec(r.reply.value)?.[1]?.trim();
            role = /(?:^|\r\n)redis_mode:([^\r\n]+)/.exec(r.reply.value)?.[1]?.trim();
            return done(pong);
          }
        }
      } catch {
        done(false, 'protocol_error');
      }
    };

    try {
      socket = opts.connect
        ? opts.connect(cfg)
        : cfg.tls
          ? tls.connect({ host: cfg.host, port: cfg.port, servername: net.isIP(cfg.host) ? undefined : cfg.host })
          : net.connect({ host: cfg.host, port: cfg.port });
    } catch {
      return done(false, 'error');
    }
    socket.setNoDelay(true);
    socket.on('data', onData);
    socket.on('error', (err: NodeJS.ErrnoException) => {
      const code = err.code ?? '';
      if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return done(false, 'connection_refused');
      if (/CERT|TLS|SSL|certificate|self.signed|EPROTO/i.test(`${code} ${err.message}`)) return done(false, 'tls_error');
      done(false, code === 'ETIMEDOUT' ? 'timeout' : 'error');
    });
    socket.on('close', () => done(false, 'error'));
    const ready = cfg.tls ? 'secureConnect' : 'connect';
    socket.once(ready, () => socket!.write(commands.map((c) => c.raw).join('')));
  });
}
