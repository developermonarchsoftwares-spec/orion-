import { AuditLogService } from '../audit-log.service';
import { SecuritySignalService, SIGNAL_DEFAULT_THRESHOLDS } from '../security-signal.service';

/** A stand-in for the Drizzle handle: captures what would be inserted. */
const fakeDb = (opts: { failWith?: unknown; failFirstOnly?: boolean } = {}) => {
  const rows: any[] = [];
  let calls = 0;
  const db = {
    insert: () => ({
      values: async (v: any) => {
        calls++;
        if (opts.failWith && (!opts.failFirstOnly || calls === 1)) throw opts.failWith;
        rows.push(v);
      },
    }),
  };
  return { db: db as any, rows };
};

describe('AuditLogService (Phase 13)', () => {
  it('redacts secrets and personal data in old and new values, nested included', async () => {
    const { db, rows } = fakeDb();
    const svc = new AuditLogService(db);
    const ok = await svc.record({
      userId: 'u1',
      action: 'SETTINGS_CHANGED',
      entityType: 'SETTINGS',
      entityId: 'e1',
      oldValues: { apiKey: 'orn_live_abcdef123456', nested: { password: 'old-pass' } },
      newValues: { webhook: { secret: 'whsec_abcdef123456', url: 'https://hooks.example.com/x' }, email: 'jane.test@example.com', rowCount: 4 },
    });
    expect(ok).toBe(true);
    const json = JSON.stringify(rows[0]);
    for (const raw of ['orn_live_abcdef123456', 'old-pass', 'whsec_abcdef123456', 'jane.test@example.com']) expect(json).not.toContain(raw);
    expect(rows[0].newValues.rowCount).toBe(4);
    expect(rows[0].newValues.webhook.url).toBe('https://hooks.example.com/x');
  });

  it('folds outcome and failure category into newValues and never stores more than 300 characters of user agent', async () => {
    const { db, rows } = fakeDb();
    await new AuditLogService(db).record({ action: 'LOGIN_FAILED', entityType: 'AUTH', outcome: 'FAILURE', failureCategory: 'BAD_PASSWORD', userAgent: 'x'.repeat(1000) });
    expect(rows[0].newValues).toMatchObject({ outcome: 'FAILURE', failureCategory: 'BAD_PASSWORD' });
    expect(rows[0].userAgent.length).toBe(300);
    expect(rows[0].userId).toBeNull();
  });

  it('record() never throws and says whether it stored the row; the log line holds the action, not the payload', async () => {
    const { db } = fakeDb({ failWith: Object.assign(new Error('connection refused'), { code: '08006' }) });
    const warn = jest.spyOn((AuditLogService.prototype as any).logger ?? console, 'warn').mockImplementation(() => undefined);
    const svc = new AuditLogService(db);
    const logSpy = jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);
    await expect(svc.record({ action: 'X', entityType: 'T', newValues: { password: 'pw-123456' } })).resolves.toBe(false);
    expect(JSON.stringify(logSpy.mock.calls)).not.toContain('pw-123456');
    expect(JSON.stringify(logSpy.mock.calls)).toContain('X');
    warn.mockRestore();
  });

  it('removes an e-mail address or token from the entity reference too', async () => {
    const { db, rows } = fakeDb();
    await new AuditLogService(db).record({ action: 'X', entityType: 'T', entityId: 'jane.test@example.com' });
    await new AuditLogService(db).record({ action: 'X', entityType: 'T', entityId: 'a1b2c3d4-0000-4000-8000-000000000000' });
    expect(rows[0].entityId).toBe('[email]');
    expect(rows[1].entityId).toBe('a1b2c3d4-0000-4000-8000-000000000000');
  });

  it('retries without the user reference when it points at a deleted account, and keeps the actor id in the values', async () => {
    const { db, rows } = fakeDb({ failWith: Object.assign(new Error('fk'), { code: '23503' }), failFirstOnly: true });
    await expect(new AuditLogService(db).record({ userId: 'gone', action: 'A', entityType: 'T' })).resolves.toBe(true);
    expect(rows[0].userId).toBeNull();
    expect(rows[0].newValues.actorUserId).toBe('gone');
  });

  it('recordStrict() throws when the write fails, so the caller transaction rolls back, and uses the transaction it is given', async () => {
    const failing = fakeDb({ failWith: new Error('disk full') });
    await expect(new AuditLogService(fakeDb().db).recordStrict({ action: 'A', entityType: 'T' }, failing.db)).rejects.toThrow('disk full');
    const own = fakeDb();
    const other = fakeDb();
    await new AuditLogService(other.db).recordStrict({ action: 'A', entityType: 'T', newValues: { password: 'pw-123456' } }, own.db);
    expect(own.rows).toHaveLength(1);
    expect(other.rows).toHaveLength(0);
    expect(JSON.stringify(own.rows[0])).not.toContain('pw-123456');
  });
});

describe('SecuritySignalService (Phase 13)', () => {
  const audit = () => {
    const record = jest.fn(async () => true);
    return { record, svc: new SecuritySignalService({ record } as any) };
  };
  afterEach(() => {
    delete process.env.SECURITY_SIGNAL_THRESHOLD_AUTHZ_DENIED;
    delete process.env.SECURITY_SIGNAL_WINDOW_SECONDS;
  });

  it('writes ONE audit entry when a threshold is first reached, not one per request', () => {
    const { record, svc } = audit();
    process.env.SECURITY_SIGNAL_THRESHOLD_AUTHZ_DENIED = '3';
    const results = Array.from({ length: 10 }, () => svc.hit('AUTHZ_DENIED', { userId: 'u1', ip: '203.0.113.9' }));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(record).toHaveBeenCalledTimes(1);
    const entry = (record.mock.calls[0] as any[])[0];
    expect(entry).toMatchObject({ action: 'ABUSE_SIGNAL', entityType: 'SECURITY_SIGNAL', entityId: 'AUTHZ_DENIED', userId: 'u1' });
    expect(entry.newValues).toMatchObject({ kind: 'AUTHZ_DENIED', threshold: 3, subjectType: 'ACCOUNT' });
    expect(entry.newValues.note).toMatch(/not proof/);
  });

  it('counts per subject and per kind', () => {
    const { record, svc } = audit();
    process.env.SECURITY_SIGNAL_THRESHOLD_AUTHZ_DENIED = '3';
    for (let i = 0; i < 2; i++) {
      svc.hit('AUTHZ_DENIED', { userId: 'a' });
      svc.hit('AUTHZ_DENIED', { userId: 'b' });
      svc.hit('RATE_LIMITED', { userId: 'a' });
    }
    expect(record).not.toHaveBeenCalled();
    svc.hit('AUTHZ_DENIED', { userId: 'a' });
    expect(record).toHaveBeenCalledTimes(1);
  });

  it('starts a new window after the window passes and can alert again', () => {
    const { record, svc } = audit();
    process.env.SECURITY_SIGNAL_THRESHOLD_AUTHZ_DENIED = '2';
    process.env.SECURITY_SIGNAL_WINDOW_SECONDS = '60';
    const t0 = 1_000_000;
    svc.hit('AUTHZ_DENIED', { ip: '203.0.113.9' }, t0);
    svc.hit('AUTHZ_DENIED', { ip: '203.0.113.9' }, t0 + 1000);
    svc.hit('AUTHZ_DENIED', { ip: '203.0.113.9' }, t0 + 2000);
    expect(record).toHaveBeenCalledTimes(1);
    svc.hit('AUTHZ_DENIED', { ip: '203.0.113.9' }, t0 + 61_000);
    svc.hit('AUTHZ_DENIED', { ip: '203.0.113.9' }, t0 + 62_000);
    expect(record).toHaveBeenCalledTimes(2);
    expect((record.mock.calls[1] as any[])[0].newValues.subjectType).toBe('ADDRESS');
  });

  it('ignores a hit with no subject, never throws when auditing fails, and bounds its memory', async () => {
    const failing = new SecuritySignalService({ record: async () => { throw new Error('db down'); } } as any);
    process.env.SECURITY_SIGNAL_THRESHOLD_AUTHZ_DENIED = '1';
    expect(failing.hit('AUTHZ_DENIED', {})).toBe(false);
    expect(() => failing.hit('AUTHZ_DENIED', { userId: 'u' })).not.toThrow();
    await new Promise((r) => setTimeout(r, 5));
    const { svc } = audit();
    for (let i = 0; i < 6000; i++) svc.hit('RATE_LIMITED', { ip: `198.51.100.${i % 250}-${i}` });
    expect(svc.size()).toBeLessThanOrEqual(5000);
  });

  it('thresholds have sane defaults and bounded overrides', () => {
    const { svc } = audit();
    expect(svc.threshold('SSRF_REJECTED')).toBe(SIGNAL_DEFAULT_THRESHOLDS.SSRF_REJECTED);
    process.env.SECURITY_SIGNAL_THRESHOLD_AUTHZ_DENIED = 'not-a-number';
    expect(svc.threshold('AUTHZ_DENIED')).toBe(SIGNAL_DEFAULT_THRESHOLDS.AUTHZ_DENIED);
    process.env.SECURITY_SIGNAL_THRESHOLD_AUTHZ_DENIED = '0';
    expect(svc.threshold('AUTHZ_DENIED')).toBe(SIGNAL_DEFAULT_THRESHOLDS.AUTHZ_DENIED);
    process.env.SECURITY_SIGNAL_WINDOW_SECONDS = '1';
    expect(svc.windowSeconds()).toBe(60);
    process.env.SECURITY_SIGNAL_WINDOW_SECONDS = '999999999';
    expect(svc.windowSeconds()).toBe(86_400);
  });
});
