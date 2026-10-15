import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { BusinessException } from '../../../common/errors/business.exception';
import { DRIZZLE_DATABASE } from '../../../database/database.constants';
import { DrizzleDb } from '../../../database/database.provider';
import * as schema from '../../../database/schema';
import { PolicyError, findSecretLikeContent, validateNewSource } from './source-policy';
import {
  INewSource,
  ISourceDefinition,
  ISourcePermissions,
  MAX_ATTESTATION_LEVELS,
  MaxAttestation,
  PERMISSION_KEYS,
  SOURCE_COST_CLASSES,
  SOURCE_DEFAULT_VERSION,
  SourceCostClass,
  SourceType,
} from './source.types';

type Row = typeof schema.peopleSources.$inferSelect;

const fail = (message: string, code: string, status = HttpStatus.BAD_REQUEST) => new BusinessException(message, code, status);

/** Row -> definition. Stored policy is re-validated: anything malformed is treated as "nothing permitted", never as "everything". */
export function toDefinition(row: Row): ISourceDefinition {
  const raw = (row.policy ?? {}) as { permissions?: Record<string, unknown>; enforceSourceType?: unknown };
  const permissions = {} as ISourcePermissions;
  for (const key of PERMISSION_KEYS) permissions[key] = raw.permissions?.[key] === true;
  const max: MaxAttestation = (MAX_ATTESTATION_LEVELS as readonly string[]).includes(row.maxAttestation) ? (row.maxAttestation as MaxAttestation) : 'NONE';
  return {
    id: row.id,
    key: row.key,
    displayName: row.displayName,
    sourceType: row.sourceType as SourceType,
    version: row.version,
    enabled: row.enabled,
    termsReference: row.termsReference,
    termsAcknowledgedAt: row.termsAcknowledgedAt,
    costClass: (SOURCE_COST_CLASSES as readonly string[]).includes(row.costClass) ? (row.costClass as SourceCostClass) : 'HIGH',
    freshnessTtlDays: row.freshnessTtlDays,
    policy: {
      permissions,
      enforceSourceType: raw.enforceSourceType === true,
      allowedEvidenceTypes: row.allowedEvidenceTypes ?? null,
      maxAttestation: permissions.attestation ? max : 'NONE',
    },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * The people source registry. Internal service (no HTTP surface in 6.1). It describes sources and decides whether a
 * source may be used; it never reads or writes People data and stores no credentials.
 */
@Injectable()
export class SourceRegistryService {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: DrizzleDb) {}

  async get(key: string): Promise<ISourceDefinition | null> {
    const [row] = await this.db.select().from(schema.peopleSources).where(eq(schema.peopleSources.key, key));
    return row ? toDefinition(row) : null;
  }

  async list(): Promise<ISourceDefinition[]> {
    const rows = await this.db.select().from(schema.peopleSources).orderBy(schema.peopleSources.key);
    return rows.map(toDefinition);
  }

  /**
   * Registers a new source. Deny by default: permissions not granted are refused, a source is disabled unless its
   * terms are acknowledged, and external source types must list their allowed evidence types. Keys are never reused.
   */
  async register(input: INewSource): Promise<ISourceDefinition> {
    let policy;
    try {
      ({ policy } = validateNewSource(input));
    } catch (err) {
      if (err instanceof PolicyError) throw fail(err.message, err.code);
      throw err;
    }
    const now = new Date();
    const acknowledged = input.termsAcknowledged === true;
    const inserted = await this.db
      .insert(schema.peopleSources)
      .values({
        key: input.key,
        displayName: input.displayName.trim(),
        sourceType: input.sourceType,
        version: input.version?.trim() || SOURCE_DEFAULT_VERSION,
        enabled: input.enabled === true && acknowledged,
        termsReference: input.termsReference?.trim() || null,
        termsAcknowledgedAt: acknowledged ? now : null,
        costClass: input.costClass ?? 'NONE',
        freshnessTtlDays: input.freshnessTtlDays ?? null,
        maxAttestation: policy.maxAttestation,
        allowedEvidenceTypes: policy.allowedEvidenceTypes,
        policy: { permissions: policy.permissions, enforceSourceType: policy.enforceSourceType },
      })
      .onConflictDoNothing({ target: schema.peopleSources.key })
      .returning();
    if (!inserted.length) throw fail(`A source with key "${input.key}" is already registered`, 'SOURCE_EXISTS', HttpStatus.CONFLICT);
    return toDefinition(inserted[0]);
  }

  async acknowledgeTerms(key: string, reference: string): Promise<ISourceDefinition> {
    const secret = findSecretLikeContent({ reference });
    if (secret) throw fail(`Registry rows must not contain credentials: ${secret}`, 'SOURCE_SECRET_REJECTED');
    if (!reference?.trim()) throw fail('A terms reference is required', 'INVALID_SOURCE');
    const [row] = await this.db
      .update(schema.peopleSources)
      .set({ termsReference: reference.trim().slice(0, 255), termsAcknowledgedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.peopleSources.key, key))
      .returning();
    if (!row) throw fail(`Source "${key}" is not registered`, 'SOURCE_NOT_REGISTERED', HttpStatus.NOT_FOUND);
    return toDefinition(row);
  }

  async setEnabled(key: string, enabled: boolean): Promise<ISourceDefinition> {
    const current = await this.get(key);
    if (!current) throw fail(`Source "${key}" is not registered`, 'SOURCE_NOT_REGISTERED', HttpStatus.NOT_FOUND);
    if (enabled && !current.termsAcknowledgedAt) {
      throw fail(`Source "${key}" cannot be enabled before its licence / terms are acknowledged`, 'SOURCE_TERMS_NOT_ACKNOWLEDGED', HttpStatus.CONFLICT);
    }
    const [row] = await this.db
      .update(schema.peopleSources)
      .set({ enabled, updatedAt: new Date() })
      .where(eq(schema.peopleSources.key, key))
      .returning();
    return toDefinition(row);
  }

  /** The gate every keyed ingestion run passes: registered, enabled, terms acknowledged. */
  async assertUsable(key: string): Promise<ISourceDefinition> {
    const def = await this.get(key);
    if (!def) throw fail(`Source "${key}" is not registered`, 'SOURCE_NOT_REGISTERED', HttpStatus.NOT_FOUND);
    if (!def.termsAcknowledgedAt) throw fail(`Source "${key}" has no acknowledged licence / terms`, 'SOURCE_TERMS_NOT_ACKNOWLEDGED', HttpStatus.CONFLICT);
    if (!def.enabled) throw fail(`Source "${key}" is disabled`, 'SOURCE_DISABLED', HttpStatus.CONFLICT);
    return def;
  }
}
