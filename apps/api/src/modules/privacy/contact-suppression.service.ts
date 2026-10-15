import { Inject, Injectable, Optional } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { BusinessException } from '../../common/errors/business.exception';
import { AuditLogService } from '../../common/services/audit-log.service';
import { DRIZZLE_DATABASE } from '../../database/database.constants';
import { DrizzleDb } from '../../database/database.provider';
import * as s from '../../database/schema';
import { expireStoredExports } from '../../common/privacy/stored-exports';

export { expireStoredExports };

/**
 * Company-contact suppression (Phase 16). The register is `contact_suppressions` (migration 0024): a one-way digest of an e-mail address,
 * a phone number or a LinkedIn URL, never the value. The database trigger on `business_contacts` stops a suppressed value from being
 * written by any writer; this service adds the part the trigger cannot do: recording a suppression and removing the value from rows
 * that already exist. Digests are computed by the SQL function `orion_contact_digest`, so the application and the trigger can never
 * disagree on how a value is normalised (case, spacing, +91 / 0 prefixes, www / query strings on LinkedIn URLs).
 */
export type ContactKind = 'EMAIL' | 'PHONE' | 'LINKEDIN';
export type SuppressionScope = 'CONTACT' | 'FIELD';
export const SUPPRESSION_REASONS = ['REMOVAL', 'SUPPRESSION', 'CORRECTED_OUT', 'LINKED_IDENTIFIER'] as const;
export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];

type Q = Pick<DrizzleDb, 'execute'>;
const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : (r?.rows ?? []));
const countOf = (r: any): number => r?.rowCount ?? 0;

/** Digest of a contact value, or null when the value cannot be normalised (too short, no "@", not a LinkedIn URL). */
export async function contactDigest(q: Q, kind: ContactKind, value: string): Promise<string | null> {
  const res = await q.execute(sql`SELECT orion_contact_digest(${kind}, ${value}) AS d`);
  return (rowsOf(res)[0]?.d as string | null) ?? null;
}

export interface IApplyResult {
  contactsRemoved: number;
  fieldsCleared: number;
}

/**
 * Brings existing `business_contacts` rows in line with the register, in one pass: a CONTACT-scope e-mail or LinkedIn match removes the
 * whole row; a FIELD-scope match (and every phone match) clears only that value and its verification flags. `onlyDigest` limits the pass to
 * one suppression (used when a new one is recorded); without it the whole register is applied (used after a restore).
 * Safe to repeat: a second run finds nothing left to change.
 */
export async function applySuppressionsToContacts(q: Q, onlyDigest?: string): Promise<IApplyResult> {
  const only = onlyDigest ? sql`AND cs.identity_digest = ${onlyDigest}` : sql``;
  const removed = await q.execute(sql`
    DELETE FROM business_contacts bc USING contact_suppressions cs
    WHERE cs.scope = 'CONTACT' ${only}
      AND ((cs.identity_kind = 'EMAIL' AND bc.email IS NOT NULL AND orion_contact_digest('EMAIL', bc.email) = cs.identity_digest)
        OR (cs.identity_kind = 'LINKEDIN' AND bc.linkedin_url IS NOT NULL AND orion_contact_digest('LINKEDIN', bc.linkedin_url) = cs.identity_digest))`);
  let fields = 0;
  fields += countOf(await q.execute(sql`
    UPDATE business_contacts bc SET email = NULL, is_email_verified = false, updated_at = now() FROM contact_suppressions cs
    WHERE cs.identity_kind = 'EMAIL' ${only} AND bc.email IS NOT NULL AND orion_contact_digest('EMAIL', bc.email) = cs.identity_digest`));
  fields += countOf(await q.execute(sql`
    UPDATE business_contacts bc SET linkedin_url = NULL, updated_at = now() FROM contact_suppressions cs
    WHERE cs.identity_kind = 'LINKEDIN' ${only} AND bc.linkedin_url IS NOT NULL AND orion_contact_digest('LINKEDIN', bc.linkedin_url) = cs.identity_digest`));
  fields += countOf(await q.execute(sql`
    UPDATE business_contacts bc SET phone = NULL, is_phone_verified = false, is_direct_dial = false, updated_at = now() FROM contact_suppressions cs
    WHERE cs.identity_kind = 'PHONE' ${only} AND bc.phone IS NOT NULL AND orion_contact_digest('PHONE', bc.phone) = cs.identity_digest`));
  return { contactsRemoved: countOf(removed), fieldsCleared: fields };
}

export interface ISuppressInput {
  kind: ContactKind;
  /** The raw value. It is hashed here and is never stored, logged or audited. */
  value: string;
  /** Phones are always FIELD scope (a number can be shared by colleagues). E-mail and LinkedIn default to CONTACT. */
  scope?: SuppressionScope;
  reasonCode: SuppressionReason;
  requestId?: string | null;
  actorId?: string | null;
}

export interface ISuppressResult {
  /** The register row (opaque id; never the digest). */
  suppressionId: string;
  created: boolean;
  scope: SuppressionScope;
  contactsRemoved: number;
  fieldsCleared: number;
  /** Stored export files expired because a value was removed (0 when nothing was removed). */
  storedExportsExpired: number;
}

@Injectable()
export class ContactSuppressionService {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: DrizzleDb,
    @Optional() private readonly audit?: AuditLogService,
  ) {}

  /**
   * Records a suppression and removes the value from existing company contacts, in one transaction together with its audit entry: if the
   * audit row cannot be written the suppression is not recorded. Repeating the same call changes nothing. A suppression can be widened
   * (FIELD to CONTACT) but never narrowed or removed; the database refuses both.
   */
  async suppress(input: ISuppressInput): Promise<ISuppressResult> {
    if (!SUPPRESSION_REASONS.includes(input.reasonCode)) throw new BusinessException('Unknown reason code', 'VALIDATION_ERROR', 400);
    const scope: SuppressionScope = input.kind === 'PHONE' ? 'FIELD' : (input.scope ?? 'CONTACT');
    return this.db.transaction(async (tx) => {
      const digest = await contactDigest(tx as any, input.kind, input.value);
      if (!digest) throw new BusinessException('The value is not a valid e-mail address, phone number or LinkedIn URL', 'VALIDATION_ERROR', 400);

      const inserted = await tx
        .insert(s.contactSuppressions)
        .values({ identityKind: input.kind, identityDigest: digest, scope, requestId: input.requestId ?? null, reasonCode: input.reasonCode })
        .onConflictDoNothing({ target: [s.contactSuppressions.identityKind, s.contactSuppressions.identityDigest] })
        .returning({ id: s.contactSuppressions.id, scope: s.contactSuppressions.scope });
      let row = inserted[0];
      const created = !!row;
      if (!row) {
        const [existing] = await tx
          .select({ id: s.contactSuppressions.id, scope: s.contactSuppressions.scope })
          .from(s.contactSuppressions)
          .where(sql`${s.contactSuppressions.identityKind} = ${input.kind} AND ${s.contactSuppressions.identityDigest} = ${digest}`);
        row = existing;
        if (row.scope === 'FIELD' && scope === 'CONTACT') {
          await tx.update(s.contactSuppressions).set({ scope: 'CONTACT' }).where(eq(s.contactSuppressions.id, row.id));
          row = { ...row, scope: 'CONTACT' };
        }
      }
      const applied = await applySuppressionsToContacts(tx as any, digest);
      const storedExportsExpired = applied.contactsRemoved + applied.fieldsCleared > 0 ? await expireStoredExports(tx as any) : 0;
      await this.audit?.recordStrict(
        {
          userId: input.actorId ?? undefined,
          action: created ? 'CONTACT_SUPPRESSION_ADDED' : 'CONTACT_SUPPRESSION_REAPPLIED',
          entityType: 'contact_suppression',
          entityId: row.id,
          newValues: { kind: input.kind, scope: row.scope, reasonCode: input.reasonCode, contactsRemoved: applied.contactsRemoved, fieldsCleared: applied.fieldsCleared, storedExportsExpired },
        } as any,
        tx as any,
      );
      return { suppressionId: row.id, created, scope: row.scope as SuppressionScope, ...applied, storedExportsExpired };
    });
  }

  /** Internal check for the write paths. Never returned to a customer: the answer only says "do not store this". */
  async isSuppressed(kind: ContactKind, value: string): Promise<boolean> {
    const digest = await contactDigest(this.db as any, kind, value);
    if (!digest) return false;
    const [hit] = await this.db
      .select({ id: s.contactSuppressions.id })
      .from(s.contactSuppressions)
      .where(sql`${s.contactSuppressions.identityKind} = ${kind} AND ${s.contactSuppressions.identityDigest} = ${digest}`)
      .limit(1);
    return !!hit;
  }
}
