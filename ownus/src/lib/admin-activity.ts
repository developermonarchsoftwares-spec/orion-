import type { ActivityLogEntry } from '@/types/admin';

/**
 * The API's audit rows are { id, action: 'ADMIN_OTP_GENERATED', actor, target, status, details: '{}', ipAddress, timestamp }.
 * The Activity Logs view works with ActivityLogEntry (a human verb, an entity type and name). Anything missing becomes a safe default, so
 * one odd row can never crash the console.
 */
type Verb = ActivityLogEntry['action'];
type Entity = ActivityLogEntry['entityType'];

const VERBS: Array<[RegExp, Verb]> = [
  [/DELET|REMOV|PURGE|ERAS/, 'Deleted'],
  [/REJECT|FAIL|DENIED|BLOCK/, 'Rejected'],
  [/UNPUBLISH/, 'Unpublished'],
  [/PUBLISH/, 'Published'],
  [/MERGE/, 'Merged'],
  [/IMPORT|UPLOAD/, 'Imported'],
  [/EXPORT|DOWNLOAD/, 'Exported'],
  [/ARCHIV/, 'Archived'],
  [/APPROV|VERIFIED/, 'Approved'],
  [/CREAT|GENERAT|REGISTER|ADD|ISSUE|LOGIN|SIGN/, 'Created'],
];

export function verbOf(action: string): Verb {
  const a = action.toUpperCase();
  return VERBS.find(([re]) => re.test(a))?.[1] ?? 'Updated';
}

export function entityOf(action: string): Entity {
  const a = action.toUpperCase();
  if (/CREDIT|PAYMENT|INVOICE|REFUND|WALLET/.test(a)) return 'Credits';
  if (/BATCH|IMPORT/.test(a)) return 'Batch';
  if (/BUSINESS|PEOPLE|PERSON|COMPANY/.test(a)) return 'Business';
  if (/SETTING|CONFIG|INTEGRATION|API_KEY|TRAFFIC|IP_RULE/.test(a)) return 'Settings';
  return 'User';
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : v == null ? fallback : String(v));

export function normalizeActivityLog(row: any): ActivityLogEntry {
  const rawAction = str(row?.action, 'UNKNOWN');
  const rawDetails = str(row?.details);
  const details = rawDetails && rawDetails !== '{}' ? `${rawAction}: ${rawDetails}` : rawAction;
  return {
    id: str(row?.id, `log-${Math.random().toString(36).slice(2)}`),
    user: str(row?.user ?? row?.actor, 'System'),
    action: verbOf(rawAction),
    entityType: entityOf(rawAction),
    entityId: str(row?.entityId ?? row?.id),
    entityName: str(row?.entityName ?? row?.target, '-'),
    details: row?.status === 'Failed' && !/fail|error/i.test(details) ? `${details} (failed)` : details,
    ipAddress: str(row?.ipAddress, '-'),
    timestamp: str(row?.timestamp),
  };
}

export const normalizeActivityLogs = (rows: unknown): ActivityLogEntry[] => (Array.isArray(rows) ? rows.map(normalizeActivityLog) : []);
