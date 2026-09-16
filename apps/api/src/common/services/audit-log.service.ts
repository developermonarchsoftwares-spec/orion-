import { Inject, Injectable, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE } from '../../database/database.constants';
import { DrizzleDb } from '../../database/database.provider';
import * as schema from '../../database/schema';

export interface ICreateAuditLogInput {
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE)
    private readonly db: DrizzleDb,
  ) {}

  /**
   * Records a security-relevant event into the immutable audit_logs table.
   * Safe to call without breaking business transactions: catches and logs any internal errors.
   */
  async record(input: ICreateAuditLogInput): Promise<void> {
    try {
      await this.db.insert(schema.auditLogs).values({
        userId: input.userId || null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ? String(input.entityId) : null,
        oldValues: input.oldValues || null,
        newValues: input.newValues || null,
        ipAddress: input.ipAddress || null,
        userAgent: input.userAgent || null,
      });

      this.logger.log(
        `[AUDIT] Action: ${input.action} | Entity: ${input.entityType}:${input.entityId || 'N/A'} | User: ${input.userId || 'ANONYMOUS'}`,
      );
    } catch (err: any) {
      // If foreign key constraint on user_id fails (e.g., test mock token or deleted user), retry with null userId
      if (err?.code === '23503' && input.userId) {
        try {
          await this.db.insert(schema.auditLogs).values({
            userId: null,
            action: input.action,
            entityType: input.entityType,
            entityId: input.entityId ? String(input.entityId) : null,
            oldValues: input.oldValues || null,
            newValues: { ...(input.newValues || {}), actorUserId: input.userId },
            ipAddress: input.ipAddress || null,
            userAgent: input.userAgent || null,
          });
          return;
        } catch {
          // ignore secondary failure
        }
      }
      this.logger.warn(`Failed to record audit log for action ${input.action}: ${err?.message}`);
    }
  }
}
