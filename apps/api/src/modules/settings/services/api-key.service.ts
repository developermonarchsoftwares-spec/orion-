import { Inject, Injectable, Logger, HttpStatus, Optional } from '@nestjs/common';
import * as crypto from 'crypto';
import { eq, and, desc } from 'drizzle-orm';
import { DRIZZLE_DATABASE } from '../../../database/database.constants';
import { DrizzleDb } from '../../../database/database.provider';
import * as schema from '../../../database/schema';
import { CreateApiKeyDto } from '../dto/api-key.dto';
import { BusinessException } from '../../../common/errors/business.exception';
import { AuditLogService } from '../../../common/services/audit-log.service';

@Injectable()
export class ApiKeyService {
  private readonly logger = new Logger(ApiKeyService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE)
    private readonly db: DrizzleDb,
    @Optional() private readonly auditLogService?: AuditLogService,
  ) {}

  /**
   * Generates a cryptographically secure API key.
   * Format: orn_live_<32 alphanumeric chars>
   * Only the SHA-256 hash is stored in PostgreSQL.
   * The plaintext key is returned strictly ONCE upon generation.
   */
  async createApiKey(userId: string, dto: CreateApiKeyDto) {
    const randomSecret = crypto.randomBytes(24).toString('base64url').replace(/[^a-zA-Z0-9]/g, '');
    const rawKey = `orn_live_${randomSecret}`;
    const keyPrefix = rawKey.substring(0, 16); // e.g. "orn_live_a1b2c3d"
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

    const scopes = dto.scopes && dto.scopes.length > 0 ? dto.scopes : ['read'];
    let expiresAt: Date | null = null;
    if (dto.expiresInDays && dto.expiresInDays > 0) {
      expiresAt = new Date(Date.now() + dto.expiresInDays * 24 * 60 * 60 * 1000);
    }

    const [created] = await this.db
      .insert(schema.apiKeys)
      .values({
        userId,
        name: dto.name.trim(),
        keyPrefix,
        keyHash,
        scopes,
        isActive: true,
        expiresAt,
      })
      .returning();

    await this.auditLogService?.record({
      userId,
      action: 'API_KEY_CREATED',
      entityType: 'API_KEY',
      entityId: created.id,
      newValues: { name: created.name, keyPrefix: created.keyPrefix, scopes },
    });

    this.logger.log(`API key created for user ${userId} with prefix ${keyPrefix}`);

    return {
      id: created.id,
      name: created.name,
      keyPrefix: created.keyPrefix,
      key: rawKey, // Plaintext key provided ONLY on creation
      scopes: created.scopes,
      isActive: created.isActive,
      expiresAt: created.expiresAt,
      createdAt: created.createdAt,
      message: 'Store this API key safely. You will not be able to see it again.',
    };
  }

  /**
   * Lists all API keys for an authenticated user.
   * Never exposes the key hash or plaintext secret.
   */
  async listApiKeys(userId: string) {
    const keys = await this.db
      .select({
        id: schema.apiKeys.id,
        name: schema.apiKeys.name,
        keyPrefix: schema.apiKeys.keyPrefix,
        scopes: schema.apiKeys.scopes,
        rateLimit: schema.apiKeys.rateLimit,
        isActive: schema.apiKeys.isActive,
        lastUsedAt: schema.apiKeys.lastUsedAt,
        expiresAt: schema.apiKeys.expiresAt,
        createdAt: schema.apiKeys.createdAt,
      })
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.userId, userId))
      .orderBy(desc(schema.apiKeys.createdAt));

    return keys;
  }

  /**
   * Revokes an active API key. Enforces ownership: User A cannot revoke User B's key.
   */
  async revokeApiKey(userId: string, keyId: string) {
    const existing = await this.db.query.apiKeys.findFirst({
      where: and(eq(schema.apiKeys.id, keyId), eq(schema.apiKeys.userId, userId)),
    });

    if (!existing) {
      throw new BusinessException('API key not found', 'API_KEY_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    const [updated] = await this.db
      .update(schema.apiKeys)
      .set({
        isActive: false,
        updatedAt: new Date(),
      })
      .where(eq(schema.apiKeys.id, keyId))
      .returning();

    await this.auditLogService?.record({
      userId,
      action: 'API_KEY_REVOKED',
      entityType: 'API_KEY',
      entityId: keyId,
      newValues: { name: existing.name, keyPrefix: existing.keyPrefix },
    });

    this.logger.log(`API key ${keyId} revoked by user ${userId}`);

    return {
      success: true,
      message: `API key '${updated.name}' (${updated.keyPrefix}...) has been revoked.`,
    };
  }
}
