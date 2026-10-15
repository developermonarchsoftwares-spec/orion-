import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as path from 'path';
import * as schema from '../../../database/schema';
import { MonitoringService } from '../monitoring.service';

/**
 * Phase 24: the security alert rules end to end through the real SQL (PostgreSQL semantics on in-memory PGlite), the real alert pipeline
 * (`alerts`, `evaluateAndNotify`) and a test-only notification sink. Synthetic audit rows only. Nothing leaves the process.
 */
const MIGRATIONS = path.resolve(__dirname, '../../../database/migrations');

describe('security alerts from the audit trail (Phase 24)', () => {
  let client: PGlite;
  let db: any;
  let mon: MonitoringService;
  let failAuditQuery = false;
  const sent: { text: string; alerts: { id: string; severity: string }[] }[] = [];

  const audit = async (action: string, n: number, o: { minutesAgo?: number; ipPrefix?: string; userIds?: string[]; entityId?: string } = {}) => {
    for (let i = 0; i < n; i++) {
      const created = new Date(Date.now() - (o.minutesAgo ?? 1) * 60_000);
      await db.insert(schema.auditLogs).values({ action, entityType: 'SYNTH', entityId: o.entityId ?? 'synthetic', ipAddress: `${o.ipPrefix ?? '203.0.113'}.${(i % 250) + 1}`, userId: o.userIds?.[i] ?? null, createdAt: created } as any);
    }
  };
  const reset = async () => {
    await client.exec('DELETE FROM audit_logs');
    (mon as any).cache.clear();
  };
  const secAlerts = async () => (await mon.alerts(true)).filter((a) => a.id.startsWith('sec_') || a.id === 'security_monitoring_unavailable');

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS });
    const pool = {
      options: { max: 5 },
      totalCount: 0,
      idleCount: 0,
      waitingCount: 0,
      query: async (text: string, params?: unknown[]) => {
        if (failAuditQuery && /FROM audit_logs/.test(text) && /action = ANY/.test(text)) throw new Error('audit table unavailable');
        return client.query(text, params as any[]);
      },
    };
    mon = new MonitoringService(pool as any);
    mon.alertSink = async (p) => {
      sent.push({ text: p.text, alerts: p.alerts.map((a) => ({ id: a.id, severity: a.severity })) });
    };
  });
  afterAll(async () => client.close());
  beforeEach(async () => {
    await reset();
    (mon as any).firing = new Map();
    sent.length = 0;
    failAuditQuery = false;
  });

  it('is quiet when nothing happened and when a rule is one event below its threshold', async () => {
    expect(await secAlerts()).toEqual([]);
    await audit('LOGIN_BLOCKED', 9);
    expect(await secAlerts()).toEqual([]);
  });

  it('fires a warning at the threshold and a critical at the critical threshold, through the real SQL', async () => {
    await audit('LOGIN_BLOCKED', 10);
    expect(await secAlerts()).toMatchObject([{ id: 'sec_login_lockouts', severity: 'warning' }]);
    await audit('LOGIN_BLOCKED', 40);
    expect(await secAlerts()).toMatchObject([{ id: 'sec_login_lockouts', severity: 'critical' }]);
  });

  it('respects the time window: old events do not count toward a 15-minute rule, but do toward a 60-minute one', async () => {
    await audit('LOGIN_BLOCKED', 60, { minutesAgo: 30 });
    expect((await secAlerts()).map((a) => a.id)).not.toContain('sec_login_lockouts');
    await audit('TOKEN_REUSE_DETECTED', 1, { minutesAgo: 30 });
    expect((await secAlerts()).map((a) => a.id)).toContain('sec_token_reuse');
    await reset();
    await audit('TOKEN_REUSE_DETECTED', 3, { minutesAgo: 90 }); // outside the 60-minute window
    expect((await secAlerts()).map((a) => a.id)).not.toContain('sec_token_reuse');
  });

  it('counts distinct subjects for the abuse rule: one noisy address is a warning, five addresses a critical', async () => {
    for (let i = 0; i < 12; i++) await db.insert(schema.auditLogs).values({ action: 'ABUSE_SIGNAL', entityType: 'SYNTH', entityId: 'AUTH_FAILURE', ipAddress: '198.51.100.7' } as any);
    expect(await secAlerts()).toMatchObject([{ id: 'sec_abuse_signals', severity: 'warning' }]);
    await reset();
    await audit('ABUSE_SIGNAL', 5);
    expect(await secAlerts()).toMatchObject([{ id: 'sec_abuse_signals', severity: 'critical' }]);
  });

  it('a signed-in subject is counted by account, not by address', async () => {
    const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
    for (const u of ids) await client.exec(`INSERT INTO users (id, email, first_name, last_name) VALUES ('${u}', '${u.slice(0, 8)}@example.test', 'A', 'B')`);
    for (let i = 0; i < 6; i++) await db.insert(schema.auditLogs).values({ action: 'ABUSE_SIGNAL', entityType: 'SYNTH', entityId: 'AUTHZ_DENIED', ipAddress: '203.0.113.9', userId: ids[i % 2] } as any);
    // 6 events, one address, two accounts: 2 subjects, a warning and not a critical
    expect(await secAlerts()).toMatchObject([{ id: 'sec_abuse_signals', severity: 'warning' }]);
  });

  it('notifies once when a rule starts firing, not again while it persists, and once when it resolves', async () => {
    await audit('TOKEN_REUSE_DETECTED', 1);
    expect(await mon.evaluateAndNotify()).toMatchObject({ notified: true });
    expect(sent).toHaveLength(1);
    expect(sent[0].alerts.map((a) => a.id)).toEqual(['sec_token_reuse']);
    (mon as any).cache.clear();
    await audit('TOKEN_REUSE_DETECTED', 1); // more events of the same rule: same alert id, no second message
    expect(await mon.evaluateAndNotify()).toMatchObject({ notified: false });
    expect(sent).toHaveLength(1);
    await reset();
    expect(await mon.evaluateAndNotify()).toMatchObject({ notified: true });
    expect(sent[1].text).toContain('Resolved: sec_token_reuse');
  });

  it('a flood of events produces one message per rule, not one per event', async () => {
    await audit('LOGIN_BLOCKED', 400);
    await audit('TOKEN_REUSE_DETECTED', 50);
    await mon.evaluateAndNotify();
    expect(sent).toHaveLength(1);
    expect(sent[0].alerts.map((a) => a.id).sort()).toEqual(['sec_login_lockouts', 'sec_token_reuse']);
  });

  it('the message holds counts and rule wording; no address, account id, e-mail or event detail', async () => {
    const id = '33333333-3333-4333-8333-333333333333';
    await client.exec(`INSERT INTO users (id, email, first_name, last_name) VALUES ('${id}', 'victim.person@example.test', 'A', 'B')`);
    for (let i = 0; i < 6; i++) {
      await db.insert(schema.auditLogs).values({ action: 'ABUSE_SIGNAL', entityType: 'SYNTH', entityId: 'victim.person@example.test', ipAddress: `203.0.113.${i + 20}`, userId: id, newValues: { token: 'secret-token-value-123' } } as any);
    }
    await audit('ABUSE_SIGNAL', 5, { ipPrefix: '192.0.2' });
    await mon.evaluateAndNotify();
    const text = sent.map((s) => s.text).join('\n');
    expect(text).toContain('Abuse thresholds reached');
    for (const forbidden of ['victim.person', '@', '203.0.113', '192.0.2', id, 'secret-token-value']) expect(text).not.toContain(forbidden);
  });

  it('when the audit trail cannot be read, the monitor says so instead of reporting quiet; it recovers afterwards', async () => {
    failAuditQuery = true;
    expect(await secAlerts()).toMatchObject([{ id: 'security_monitoring_unavailable', severity: 'warning' }]);
    failAuditQuery = false;
    (mon as any).cache.clear();
    expect(await secAlerts()).toEqual([]);
  });

  it('a security alert is not reported "resolved" while the monitor cannot read its source; it is reported only when the rule really stops firing (Phase 31)', async () => {
    await audit('TOKEN_REUSE_DETECTED', 1);
    await mon.evaluateAndNotify();
    expect(sent).toHaveLength(1);
    expect(sent[0].alerts.map((a) => a.id)).toEqual(['sec_token_reuse']);
    // the audit trail cannot be read: the rule disappears from the evaluation, but nothing has been resolved
    failAuditQuery = true;
    (mon as any).cache.clear();
    await mon.evaluateAndNotify();
    expect(sent.map((m) => m.text).join('\n')).not.toContain('Resolved: sec_token_reuse');
    // the source comes back and the rule still fires: no second "started" message either
    failAuditQuery = false;
    (mon as any).cache.clear();
    const stillFiring = await mon.evaluateAndNotify();
    expect(stillFiring.notified).toBe(sent.length > 1);
    expect(sent.map((m) => m.alerts.map((a) => a.id)).flat().filter((id) => id === 'sec_token_reuse')).toHaveLength(1);
    // and only when the events are gone is it resolved
    await reset();
    (mon as any).cache.clear();
    await mon.evaluateAndNotify();
    expect(sent[sent.length - 1].text).toContain('Resolved: sec_token_reuse');
  });

  it('a failing or refusing notifier never throws into the caller (a private webhook address is refused by the outbound guard)', async () => {
    const saved = { sink: mon.alertSink, url: process.env.MONITORING_ALERT_WEBHOOK_URL, allow: process.env.INTEGRATIONS_ALLOW_PRIVATE_NETWORK };
    try {
      await audit('TOKEN_REUSE_DETECTED', 1);
      mon.alertSink = async () => {
        throw new Error('sink down');
      };
      await expect(mon.evaluateAndNotify()).resolves.toMatchObject({ notified: false }); // the failure is contained
      mon.alertSink = undefined;
      delete process.env.INTEGRATIONS_ALLOW_PRIVATE_NETWORK;
      process.env.MONITORING_ALERT_WEBHOOK_URL = 'http://10.0.0.5/hook';
      (mon as any).firing = new Map();
      (mon as any).cache.clear();
      await expect(mon.evaluateAndNotify()).resolves.toMatchObject({ notified: true });
    } finally {
      mon.alertSink = saved.sink;
      if (saved.url === undefined) delete process.env.MONITORING_ALERT_WEBHOOK_URL;
      else process.env.MONITORING_ALERT_WEBHOOK_URL = saved.url;
      if (saved.allow !== undefined) process.env.INTEGRATIONS_ALLOW_PRIVATE_NETWORK = saved.allow;
    }
  });

  it('evaluating repeatedly within the cache window runs the audit query once (opening the dashboard repeatedly is not an amplifier)', async () => {
    let calls = 0;
    const real = (mon as any).pool.query;
    (mon as any).pool.query = async (t: string, p?: unknown[]) => {
      if (/action = ANY/.test(t)) calls++;
      return real(t, p);
    };
    try {
      await mon.alerts(false);
      await mon.alerts(false);
      await mon.alerts(false);
      expect(calls).toBe(1);
    } finally {
      (mon as any).pool.query = real;
    }
  });
});
