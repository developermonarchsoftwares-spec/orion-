import { currentContext } from '../observability/tracing';
import { redactDeep } from '../observability/redact';

/**
 * The `newValues` of an audit row written directly into a transaction (not through AuditLogService): redacted the same way, and carrying
 * the request correlation id. Five writers inserted audit rows directly and so produced rows an investigator could not tie to a request
 * (registration, social registration, every People review decision) and, for social registration, an e-mail address (Phase 31).
 */
/**
 * Same, without redaction, for audit rows whose content is the point of the record: a People review decision keeps the reviewer's
 * identity and the old and new values of the field they changed (the review workflow is audited on purpose and its tests pin that).
 * Only the request correlation id is added.
 */
export function withRequestId(values: Record<string, unknown>): Record<string, unknown> {
  const requestId = currentContext()?.requestId;
  return requestId && values.requestId === undefined ? { ...values, requestId } : values;
}

export function auditValues(values?: Record<string, unknown> | null): Record<string, unknown> | null {
  const requestId = currentContext()?.requestId;
  const merged: Record<string, unknown> = { ...(values ?? {}) };
  if (requestId && merged.requestId === undefined) merged.requestId = requestId;
  return Object.keys(merged).length ? (redactDeep(merged) as Record<string, unknown>) : null;
}
