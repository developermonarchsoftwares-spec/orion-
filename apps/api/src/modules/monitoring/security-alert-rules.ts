/**
 * Security alert rules (Phase 24). Pure functions over aggregated audit-event counts, so every threshold can be tested without a database.
 *
 * Source: the `audit_logs` table (events that are already written; no new event store, no new tracking). One grouped query per evaluation
 * (cached by the monitoring service) supplies, per audit action, how many events and how many distinct subjects (account id, else client
 * address) occurred in the last 15, 60 and 120 minutes. Alert ids are fixed per rule, so the existing notifier tells the operator once when a
 * rule starts firing, once when it resolves, and reminds about a critical one every 6 hours: a flood of events produces one message, not many.
 *
 * Thresholds are STARTING VALUES. Orion has no production traffic history, so none of them is derived from a baseline; they were chosen so
 * that a single ordinary mistake (one wrong password, one expired token) never fires anything, and they can be changed without a deploy:
 * MONITORING_SEC_<RULE>_WARN and MONITORING_SEC_<RULE>_CRIT (whole numbers; 0 or empty keeps the default). They must be reviewed after the
 * first weeks of real use (docs/SECURITY_MONITORING_PLAN.md section 4).
 *
 * An alert only says "this many events of this kind happened"; it names no account, address, e-mail or value. Nothing here blocks anyone.
 */
export type Severity = 'info' | 'warning' | 'critical';

export interface IAuditCountRow {
  action: string;
  n15: number;
  n60: number;
  n120: number;
  s15: number;
  s60: number;
  s120: number;
}

export interface ISecurityRule {
  id: string;
  title: string;
  actions: readonly string[];
  /** Minutes of history the rule looks at. */
  window: 15 | 60 | 120;
  /** Count events, or distinct subjects (an account or an address). */
  metric: 'events' | 'subjects';
  warn: number;
  crit: number | null;
  /** One sentence for the operator: what to look at first. */
  hint: string;
}

export const SECURITY_RULES: readonly ISecurityRule[] = [
  {
    id: 'sec_abuse_signals', title: 'Abuse thresholds reached', actions: ['ABUSE_SIGNAL'], window: 60, metric: 'subjects', warn: 1, crit: 5,
    hint: 'Look at the ABUSE_SIGNAL audit entries: the kind (AUTH_FAILURE, SSRF_REJECTED, EXPORT_REFUSED, ...) and whether one or many subjects are involved.',
  },
  {
    id: 'sec_token_reuse', title: 'Refresh-token reuse detected', actions: ['TOKEN_REUSE_DETECTED'], window: 60, metric: 'events', warn: 1, crit: 3,
    hint: 'A refresh token was presented twice: a stolen or replayed session. The family is revoked; check the affected accounts.',
  },
  {
    id: 'sec_login_lockouts', title: 'Many sign-in lockouts', actions: ['LOGIN_BLOCKED'], window: 15, metric: 'events', warn: 10, crit: 50,
    hint: 'Lockouts across many accounts in a short time suggest credential stuffing.',
  },
  {
    id: 'sec_admin_signin_failures', title: 'Administrator sign-in failures', actions: ['ADMIN_OTP_FAILED', 'ADMIN_OTP_UNAUTHORIZED_DOMAIN', 'ADMIN_OTP_NOT_AN_ADMIN', 'MFA_FAILED'], window: 15, metric: 'events', warn: 5, crit: 20,
    hint: 'Few people sign in as administrators, so repeated failures matter more here than on the customer side.',
  },
  {
    id: 'sec_privacy_processing_failed', title: 'Privacy or retention processing failed', actions: ['RETENTION_JOB_FAILED', 'PRIVACY_DELETE_FAILED'], window: 120, metric: 'events', warn: 1, crit: 3,
    hint: 'A deletion or retention run failed; the job retries hourly. Check the error code in the audit entry and the API log.',
  },
  {
    id: 'sec_payment_verification_failed', title: 'Payment verification failures', actions: ['PAYMENT_VERIFICATION_FAILED'], window: 60, metric: 'events', warn: 3, crit: 15,
    hint: 'Failed signature or amount checks can mean tampering with a payment callback.',
  },
  {
    id: 'sec_publication_refused', title: 'Publication or review refusals', actions: ['PUBLISH_REFUSED', 'IMPORT_REVIEW_REFUSED', 'ADMIN_BUSINESS_PUBLISH_REFUSED'], window: 60, metric: 'events', warn: 5, crit: null,
    hint: 'An administrator is repeatedly trying to publish records from sources that are not approved, or that fail review.',
  },
  {
    id: 'sec_credit_adjustments', title: 'Unusual number of manual credit adjustments', actions: ['CREDIT_ADJUSTMENT'], window: 60, metric: 'events', warn: 10, crit: 30,
    hint: 'Manual credit changes are administrator-only and audited; review who made them and why.',
  },
  {
    id: 'sec_export_failures', title: 'Repeated export failures', actions: ['EXPORT_FAILED'], window: 60, metric: 'events', warn: 5, crit: null,
    hint: 'Exports are failing; check whether a dataset or the database is the cause.',
  },
];

const intFrom = (v: string | undefined): number | null => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 1_000_000) : null;
};

/** A rule with any MONITORING_SEC_<RULE>_WARN / _CRIT override applied. An invalid override is ignored. */
export function effectiveRule(rule: ISecurityRule, env: NodeJS.ProcessEnv = process.env): ISecurityRule {
  const key = rule.id.replace(/^sec_/, '').toUpperCase();
  const warn = intFrom(env[`MONITORING_SEC_${key}_WARN`]) ?? rule.warn;
  const crit = intFrom(env[`MONITORING_SEC_${key}_CRIT`]) ?? rule.crit;
  return { ...rule, warn, crit: crit !== null && crit < warn ? warn : crit };
}

export interface ISecurityAlert {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
}

/** Turns the aggregated counts into alerts. Rules with nothing to report produce nothing. Details contain counts only. */
export function evaluateSecurityRules(rows: readonly IAuditCountRow[], env: NodeJS.ProcessEnv = process.env): ISecurityAlert[] {
  const out: ISecurityAlert[] = [];
  for (const base of SECURITY_RULES) {
    const rule = effectiveRule(base, env);
    const mine = rows.filter((r) => rule.actions.includes(r.action));
    const pick = (r: IAuditCountRow) => (rule.metric === 'events' ? (rule.window === 15 ? r.n15 : rule.window === 60 ? r.n60 : r.n120) : rule.window === 15 ? r.s15 : rule.window === 60 ? r.s60 : r.s120);
    // distinct subjects cannot be added across actions without double counting, so use the largest single value; events are summed
    const value = rule.metric === 'events' ? mine.reduce((a, r) => a + pick(r), 0) : mine.reduce((a, r) => Math.max(a, pick(r)), 0);
    if (value < rule.warn) continue;
    const severity: Severity = rule.crit !== null && value >= rule.crit ? 'critical' : 'warning';
    const unit = rule.metric === 'events' ? 'event(s)' : 'subject(s)';
    out.push({ id: rule.id, severity, title: rule.title, detail: `${value} ${unit} in the last ${rule.window} minutes (warning at ${rule.warn}${rule.crit !== null ? `, critical at ${rule.crit}` : ''}). ${rule.hint}` });
  }
  return out;
}

/** The single grouped query. Parameter $1 is the list of audit actions. Uses the created_at index; at most one row per action. */
export const SECURITY_COUNTS_SQL = `
  SELECT action,
    count(*) FILTER (WHERE created_at > now() - interval '15 minutes')::int AS n15,
    count(*) FILTER (WHERE created_at > now() - interval '60 minutes')::int AS n60,
    count(*)::int AS n120,
    count(DISTINCT coalesce(user_id::text, ip_address, 'unknown')) FILTER (WHERE created_at > now() - interval '15 minutes')::int AS s15,
    count(DISTINCT coalesce(user_id::text, ip_address, 'unknown')) FILTER (WHERE created_at > now() - interval '60 minutes')::int AS s60,
    count(DISTINCT coalesce(user_id::text, ip_address, 'unknown'))::int AS s120
  FROM audit_logs
  WHERE created_at > now() - interval '120 minutes' AND action = ANY($1::text[])
  GROUP BY action`;

export const SECURITY_ACTIONS: readonly string[] = [...new Set(SECURITY_RULES.flatMap((r) => r.actions))];
