import { Inject, Injectable, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE } from '../../database/database.constants';
import { DrizzleDb } from '../../database/database.provider';
import * as schema from '../../database/schema';
import { redactDeep } from '../observability/redact';
import { scrubText } from '../observability/scrub';
import { currentContext } from '../observability/tracing';

/** A plain identifier (uuid, numeric id, key name) is kept exactly: the digit scrubber would otherwise damage the one uuid in 270 whose last group is all digits. */
const PLAIN_ENTITY_ID = /^[A-Za-z0-9._:-]{1,80}$/;

export type AuditOutcome = 'SUCCESS' | 'FAILURE' | 'DENIED' | 'REFUSED';

export interface ICreateAuditLogInput {
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  /** Result of the action. Merged into newValues.outcome. */
  outcome?: AuditOutcome;
  /** A short category for a failure or refusal (for example BAD_CREDENTIALS, LOCKED, FORBIDDEN). Never free text. */
  failureCategory?: string;
}

/** Any object with Drizzle's insert, so a caller can pass its open transaction (see recordStrict). */
type InsertCapable = Pick<DrizzleDb, 'insert'>;

/**
 * Security and business audit trail, stored in the `audit_logs` table.
 *
 * What this is NOT: a tamper-proof or immutable record. The table is an ordinary table: anyone with database write access (including the
 * application's own role) can change or delete rows, and nothing here chains or signs them. It is an investigation aid whose integrity depends
 * on database access control, backups and shipping the application log to a separate store (see docs/INCIDENT_RESPONSE.md).
 *
 * Two ways to write:
 *  - `record()`: best effort. A failure is logged (action name and error text only) and never breaks the business operation. Use for events
 *    where losing the entry is acceptable.
 *  - `recordStrict(input, tx)`: throws on failure and takes the caller's transaction, so the change and its audit row commit or roll back
 *    together. Use where an operation must not happen without a record (money, roles, privacy decisions).
 *
 * Every entry is passed through `redactDeep` (secrets and personal contact details are removed by key and by value, nested objects
 * included) and carries the request correlation id when the write happens inside a request.
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE)
    private readonly db: DrizzleDb,
  ) {}

  /** The row to insert: redacted, with outcome, failure category and correlation id folded into newValues. */
  private build(input: ICreateAuditLogInput, userId: string | null, extra: Record<string, unknown> = {}) {
    const ctx = currentContext();
    const meta: Record<string, unknown> = { ...(input.newValues || {}), ...extra };
    if (input.outcome && meta.outcome === undefined) meta.outcome = input.outcome;
    if (input.failureCategory && meta.failureCategory === undefined) meta.failureCategory = input.failureCategory;
    if (ctx?.requestId && meta.requestId === undefined) meta.requestId = ctx.requestId;
    const hasNew = input.newValues || input.outcome || input.failureCategory || ctx?.requestId || Object.keys(extra).length > 0;
    return {
      userId,
      action: input.action,
      entityType: input.entityType,
      // an entity reference is an id; if a caller passes something that carries an address or a token it is removed here
      entityId: input.entityId ? (PLAIN_ENTITY_ID.test(String(input.entityId)) ? String(input.entityId) : scrubText(String(input.entityId), 255)) : null,
      oldValues: input.oldValues ? (redactDeep(input.oldValues) as Record<string, unknown>) : null,
      newValues: hasNew ? (redactDeep(meta) as Record<string, unknown>) : null,
      ipAddress: input.ipAddress || null,
      userAgent: input.userAgent ? String(input.userAgent).slice(0, 300) : null,
    };
  }

  /** Best-effort write. Returns whether the row was stored. */
  async record(input: ICreateAuditLogInput): Promise<boolean> {
    try {
      await this.db.insert(schema.auditLogs).values(this.build(input, input.userId || null));
      this.logger.log(`[AUDIT] Action: ${input.action} | Entity: ${input.entityType}:${input.entityId || 'N/A'} | User: ${input.userId || 'ANONYMOUS'}`);
      return true;
    } catch (err: any) {
      // If foreign key constraint on user_id fails (e.g., test mock token or deleted user), retry with null userId
      if (err?.code === '23503' && input.userId) {
        try {
          await this.db.insert(schema.auditLogs).values(this.build(input, null, { actorUserId: input.userId }));
          return true;
        } catch {
          // ignore secondary failure
        }
      }
      // never the payload: only the action and the error text
      this.logger.warn(`Failed to record audit log for action ${input.action}: ${err?.message}`);
      return false;
    }
  }

  /**
   * Writes inside the caller's transaction and throws on failure, so the audited change rolls back with its record. Pass the open `tx`.
   * Without a `tx` it still throws, but the audit row is then committed on its own.
   */
  async recordStrict(input: ICreateAuditLogInput, tx?: InsertCapable): Promise<void> {
    await (tx ?? this.db).insert(schema.auditLogs).values(this.build(input, input.userId || null));
  }
}
