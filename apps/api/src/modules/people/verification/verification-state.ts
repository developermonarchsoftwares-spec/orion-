import { and, eq, inArray, sql } from 'drizzle-orm';
import { DrizzleDb } from '../../../database/database.provider';
import * as schema from '../../../database/schema';
import { laterDate, rollupPersonVerification } from '../people-rollup';
import {
  CONFIDENCE_FLOOR,
  ClaimType,
  claimState,
  claimedValueFor,
  deriveContactStatus,
  deriveRoleStatus,
  targetKeyOf,
} from '../policies/claim-verification.policy';
import { toLedgerRow } from './verification-panel';

type Tx = Parameters<Parameters<DrizzleDb['transaction']>[0]>[0];

/**
 * SINGLE SOURCE OF TRUTH RULE
 *
 *   people_verifications (the ledger)  = authoritative, evidence-backed history: WHO / WHEN / WHY / on WHAT evidence.
 *   company_people.verification_status, person_contacts.verification_status, people.verification_status
 *                                      = operational state DERIVED from the ledger (needed by search, cards, customer contract).
 *
 * The derived columns are written ONLY by reconcileRole / reconcileContact / rollupPersonVerification (this file and
 * people-rollup.ts). Every code path that changes a ledger row, or a value a ledger row is about, ends by calling them,
 * so the two cannot silently disagree. Ingestion, reviewer verification, dispute and reviewer edits all go through them.
 */

/** Serialises writers of one claim target (deterministic outcome under concurrency). */
export async function lockTarget(tx: Tx, targetKey: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${targetKey}))`);
}

export async function roleLedger(tx: Tx, roleId: string) {
  return tx
    .select()
    .from(schema.peopleVerifications)
    .where(inArray(schema.peopleVerifications.targetKey, [`TITLE:${roleId}`, `RELATIONSHIP:${roleId}`]));
}

/** Recomputes a role's verification columns from the ledger (never from ingestion input directly). */
export async function reconcileRole(tx: Tx, roleId: string, now: Date = new Date()) {
  const [role] = await tx.select().from(schema.companyPeople).where(eq(schema.companyPeople.id, roleId));
  if (!role) return null;
  const rows = (await roleLedger(tx, roleId)).map(toLedgerRow);
  const stateOf = (claim: 'TITLE' | 'RELATIONSHIP', value: string) =>
    claimState(rows.filter((r) => r.claimType === claim), claimedValueFor(claim, value), now, { ignoreAge: true });
  const title = stateOf('TITLE', role.normalizedJobTitle);
  const rel = stateOf('RELATIONSHIP', role.businessId);
  const status = deriveRoleStatus({ TITLE: title.state, RELATIONSHIP: rel.state });

  const verified = [title, rel].filter((s) => s.state === 'VERIFIED');
  const floor = verified.length === 2 ? CONFIDENCE_FLOOR.ROLE_BOTH_CLAIMS : verified.length === 1 ? CONFIDENCE_FLOOR.ROLE_ONE_CLAIM : 0;
  const lastVerifiedAt = laterDate(role.lastVerifiedAt, ...verified.map((s) => s.row!.verifiedAt));
  await tx
    .update(schema.companyPeople)
    .set({
      verificationStatus: status,
      confidenceScore: Math.max(role.confidenceScore, floor),
      lastVerifiedAt,
      updatedAt: status === role.verificationStatus ? role.updatedAt : now,
    })
    .where(eq(schema.companyPeople.id, roleId));
  await rollupPersonVerification(tx, role.personId);
  return { before: role.verificationStatus, after: status };
}

/** Recomputes one contact's verification columns from the ledger for its CURRENT value. */
export async function reconcileContact(tx: Tx, contactId: string, now: Date = new Date()) {
  const [contact] = await tx.select().from(schema.personContacts).where(eq(schema.personContacts.id, contactId));
  if (!contact) return null;
  const claim: ClaimType = contact.contactType === 'WORK_EMAIL' ? 'EMAIL' : 'PHONE';
  const rows = await tx
    .select()
    .from(schema.peopleVerifications)
    .where(eq(schema.peopleVerifications.targetKey, targetKeyOf(claim, { personId: contact.personId, contactId })));
  const st = claimState(rows.map(toLedgerRow), claimedValueFor(claim, contact.normalizedValue), now, { ignoreAge: true });
  const status = deriveContactStatus(st.state);
  await tx
    .update(schema.personContacts)
    .set({
      verificationStatus: status,
      confidenceScore: st.state === 'VERIFIED' ? Math.max(contact.confidenceScore, CONFIDENCE_FLOOR.CONTACT) : contact.confidenceScore,
      lastVerifiedAt: st.state === 'VERIFIED' ? laterDate(contact.lastVerifiedAt, st.row!.verifiedAt) : contact.lastVerifiedAt,
      updatedAt: status === contact.verificationStatus ? contact.updatedAt : now,
    })
    .where(eq(schema.personContacts.id, contactId));
  await rollupPersonVerification(tx, contact.personId);
  return { before: contact.verificationStatus, after: status };
}

export type AttestationResult = 'RECORDED' | 'UPDATED' | 'EXISTS' | 'BLOCKED_BY_REVIEWER';

/**
 * Records a decision that the SYSTEM (not a person) is relaying from a source: ingestion-attested evidence, a source
 * conflict report, or a migration backfill. It never carries a human id and always says it is a system event.
 *  - VERIFIED never overwrites an existing decision for the same target and value (a reviewer's verification, a
 *    dispute, or an earlier attestation always wins).
 *  - DISPUTED (the source reports a conflict) may flip an earlier SYSTEM attestation, exactly as before, but never
 *    a REVIEWER's decision: that is reported as BLOCKED_BY_REVIEWER so the caller can surface a warning instead.
 */
export async function recordSystemAttestation(
  tx: Tx,
  a: {
    claim: ClaimType;
    personId: string;
    roleId?: string;
    contactId?: string;
    value: string;
    status: 'VERIFIED' | 'DISPUTED';
    evidence: { id: string; sourceType: string } | null;
    attestedBy: string;
    method?: 'INGESTION_ATTESTED' | 'LEGACY_BACKFILL';
    verifiedAt: Date;
    note: string;
    strength?: number;
  },
): Promise<AttestationResult> {
  const key = targetKeyOf(a.claim, { personId: a.personId, roleId: a.roleId, contactId: a.contactId });
  await lockTarget(tx, key);
  const claimed = claimedValueFor(a.claim, a.value);
  const system = {
    verifiedByKind: 'SYSTEM',
    method: a.method ?? 'INGESTION_ATTESTED',
    attestedBy: a.attestedBy,
    verifiedById: null,
    verifiedByLabel: 'system:ingestion',
    verifiedAt: a.verifiedAt,
    note: a.note,
  };
  const inserted = await tx
    .insert(schema.peopleVerifications)
    .values({
      claimType: a.claim,
      targetKey: key,
      personId: a.personId,
      companyPersonId: a.claim === 'TITLE' || a.claim === 'RELATIONSHIP' ? (a.roleId ?? null) : null,
      contactId: a.contactId ?? null,
      claimedValue: claimed,
      status: a.status,
      evidenceId: a.evidence?.id ?? null,
      evidenceStrength: a.strength ?? 0,
      ...system,
    })
    .onConflictDoNothing({ target: [schema.peopleVerifications.targetKey, schema.peopleVerifications.claimedValue] })
    .returning({ id: schema.peopleVerifications.id });
  if (inserted.length) return 'RECORDED';
  if (a.status === 'VERIFIED') return 'EXISTS';

  const [existing] = await tx
    .select()
    .from(schema.peopleVerifications)
    .where(and(eq(schema.peopleVerifications.targetKey, key), eq(schema.peopleVerifications.claimedValue, claimed)));
  if (!existing || existing.status === 'DISPUTED') return 'EXISTS';
  if (existing.verifiedByKind === 'REVIEWER') return 'BLOCKED_BY_REVIEWER';
  await tx
    .update(schema.peopleVerifications)
    .set({ status: 'DISPUTED', ...system, updatedAt: a.verifiedAt })
    .where(eq(schema.peopleVerifications.id, existing.id));
  return 'UPDATED';
}
