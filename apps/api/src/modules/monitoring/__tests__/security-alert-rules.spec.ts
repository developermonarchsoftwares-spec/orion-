import * as fs from 'fs';
import * as path from 'path';
import { SECURITY_ACTIONS, SECURITY_RULES, effectiveRule, evaluateSecurityRules, type IAuditCountRow } from '../security-alert-rules';

/**
 * Phase 24: the security alert rules as pure functions. Thresholds are tested at, one below and one above their boundaries; the rules are
 * checked against the source so that none of them can refer to an audit event that nothing emits.
 */
const row = (action: string, o: Partial<IAuditCountRow> = {}): IAuditCountRow => ({ action, n15: 0, n60: 0, n120: 0, s15: 0, s60: 0, s120: 0, ...o });
const only = (id: string, rows: IAuditCountRow[], env: NodeJS.ProcessEnv = {}) => evaluateSecurityRules(rows, env).filter((a) => a.id === id);

describe('security alert rules (thresholds)', () => {
  it('nothing fires without events, and a single ordinary event does not fire a rule that needs several', () => {
    expect(evaluateSecurityRules([], {})).toEqual([]);
    expect(only('sec_login_lockouts', [row('LOGIN_BLOCKED', { n15: 9 })])).toEqual([]); // warn at 10
    expect(only('sec_admin_signin_failures', [row('ADMIN_OTP_FAILED', { n15: 4 })])).toEqual([]); // warn at 5
    expect(only('sec_payment_verification_failed', [row('PAYMENT_VERIFICATION_FAILED', { n60: 2 })])).toEqual([]); // warn at 3
  });

  it('fires a warning exactly at the warning threshold and a critical exactly at the critical one', () => {
    expect(only('sec_login_lockouts', [row('LOGIN_BLOCKED', { n15: 10 })])).toMatchObject([{ severity: 'warning' }]);
    expect(only('sec_login_lockouts', [row('LOGIN_BLOCKED', { n15: 49 })])).toMatchObject([{ severity: 'warning' }]);
    expect(only('sec_login_lockouts', [row('LOGIN_BLOCKED', { n15: 50 })])).toMatchObject([{ severity: 'critical' }]);
    expect(only('sec_token_reuse', [row('TOKEN_REUSE_DETECTED', { n60: 1 })])).toMatchObject([{ severity: 'warning' }]);
    expect(only('sec_token_reuse', [row('TOKEN_REUSE_DETECTED', { n60: 3 })])).toMatchObject([{ severity: 'critical' }]);
  });

  it('a rule without a critical level never goes above warning', () => {
    expect(only('sec_publication_refused', [row('PUBLISH_REFUSED', { n60: 5000 })])).toMatchObject([{ severity: 'warning' }]);
    expect(only('sec_export_failures', [row('EXPORT_FAILED', { n60: 5000 })])).toMatchObject([{ severity: 'warning' }]);
  });

  it('events of several actions in one rule are added together', () => {
    const rows = [row('ADMIN_OTP_FAILED', { n15: 2 }), row('ADMIN_OTP_NOT_AN_ADMIN', { n15: 2 }), row('MFA_FAILED', { n15: 1 })];
    expect(only('sec_admin_signin_failures', rows)).toMatchObject([{ severity: 'warning' }]); // 2 + 2 + 1 = 5
    expect(only('sec_admin_signin_failures', rows.slice(0, 2))).toEqual([]); // 4
  });

  it('a subject-based rule counts distinct subjects, not events: one noisy source stays a warning, many sources are critical', () => {
    expect(only('sec_abuse_signals', [row('ABUSE_SIGNAL', { n60: 40, s60: 1 })])).toMatchObject([{ severity: 'warning' }]);
    expect(only('sec_abuse_signals', [row('ABUSE_SIGNAL', { n60: 5, s60: 5 })])).toMatchObject([{ severity: 'critical' }]);
    expect(only('sec_abuse_signals', [row('ABUSE_SIGNAL', { n60: 0, s60: 0 })])).toEqual([]);
  });

  it('each rule looks only at its own window: an old burst does not fire a 15-minute rule', () => {
    expect(only('sec_login_lockouts', [row('LOGIN_BLOCKED', { n15: 0, n60: 400, n120: 400 })])).toEqual([]);
    expect(only('sec_privacy_processing_failed', [row('RETENTION_JOB_FAILED', { n15: 0, n60: 0, n120: 1 })])).toMatchObject([{ severity: 'warning' }]); // 2-hour rule
  });

  it('unrelated actions are ignored', () => {
    expect(evaluateSecurityRules([row('LOGIN_SUCCESS', { n15: 9999, n60: 9999, n120: 9999, s15: 9999, s60: 9999, s120: 9999 })], {})).toEqual([]);
  });

  it('alerts are named by rule, so one rule is one alert however many events it counts (the notifier deduplicates on this id)', () => {
    const a = only('sec_login_lockouts', [row('LOGIN_BLOCKED', { n15: 500 })]);
    const b = only('sec_login_lockouts', [row('LOGIN_BLOCKED', { n15: 900 })]);
    expect(a).toHaveLength(1);
    expect(a[0].id).toBe(b[0].id);
    expect(new Set(SECURITY_RULES.map((r) => r.id)).size).toBe(SECURITY_RULES.length);
  });

  it('thresholds can be overridden by environment variables; an invalid override is ignored; critical never sits below warning', () => {
    const rule = SECURITY_RULES.find((r) => r.id === 'sec_login_lockouts')!;
    expect(effectiveRule(rule, { MONITORING_SEC_LOGIN_LOCKOUTS_WARN: '3' }).warn).toBe(3);
    expect(effectiveRule(rule, { MONITORING_SEC_LOGIN_LOCKOUTS_WARN: 'abc' }).warn).toBe(10);
    expect(effectiveRule(rule, { MONITORING_SEC_LOGIN_LOCKOUTS_WARN: '0' }).warn).toBe(10);
    expect(effectiveRule(rule, { MONITORING_SEC_LOGIN_LOCKOUTS_WARN: '-4' }).warn).toBe(10);
    expect(effectiveRule(rule, { MONITORING_SEC_LOGIN_LOCKOUTS_WARN: '80' }).crit).toBe(80); // 50 would be below the new warning
    expect(only('sec_login_lockouts', [row('LOGIN_BLOCKED', { n15: 3 })], { MONITORING_SEC_LOGIN_LOCKOUTS_WARN: '3' })).toMatchObject([{ severity: 'warning' }]);
  });

  it('the text of an alert holds counts and rule wording only', () => {
    const [a] = only('sec_abuse_signals', [row('ABUSE_SIGNAL', { n60: 7, s60: 6 })]);
    expect(a.detail).toMatch(/6 subject\(s\) in the last 60 minutes/);
    expect(a.detail).not.toMatch(/@|\d+\.\d+\.\d+\.\d+|[0-9a-f]{8}-[0-9a-f]{4}/);
  });
});

describe('security alert rules (they refer to events that exist)', () => {
  const SRC = path.resolve(__dirname, '../../..');
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === '__tests__' || e.name === 'node_modules' ? [] : walk(path.join(d, e.name))) : e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts') ? [path.join(d, e.name)] : []));
  const source = walk(SRC).filter((f) => !f.endsWith('security-alert-rules.ts')).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  // the gateway (web app) writes some of these events too
  const gateway = fs.readFileSync(path.resolve(SRC, '../../../ownus/src/app/api/v1/[...path]/route.ts'), 'utf8');

  it.each(SECURITY_ACTIONS.map((a) => [a]))('%s is emitted somewhere in the code', (action) => {
    expect(source.includes(`'${action}'`) || gateway.includes(`'${action}'`)).toBe(true);
  });
});
