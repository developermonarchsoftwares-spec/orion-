import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { BusinessException } from '../../../common/errors/business.exception';
import { DRIZZLE_DATABASE } from '../../../database/database.constants';
import { DrizzleDb } from '../../../database/database.provider';
import * as schema from '../../../database/schema';
import { IReviewContext, PeoplePublishingService } from '../people-publishing.service';
import { evidenceFingerprint, normalizeSourceLocator } from '../people.utils';
import {
  ACCEPTED_EVIDENCE,
  CLAIM_TYPES,
  ClaimType,
  SENSITIVE_CLAIMS,
  claimState,
  claimedValueFor,
  evidenceStrength,
  isEvidenceAccepted,
  targetKeyOf,
} from '../policies/claim-verification.policy';
import { lockTarget, reconcileContact, reconcileRole } from './verification-state';
import { buildVerificationPanel, currentClaimValue, toLedgerRow } from './verification-panel';
import { DisputeClaimDto, VerifyClaimDto } from './verification.dto';

type Tx = Parameters<Parameters<DrizzleDb['transaction']>[0]>[0];
type RoleRow = typeof schema.companyPeople.$inferSelect;
type PersonRow = typeof schema.people.$inferSelect;
type ContactRow = typeof schema.personContacts.$inferSelect;

const bad = (message: string, code: string, status = HttpStatus.BAD_REQUEST) => new BusinessException(message, code, status);

export type VerifyOutcome = 'VERIFIED' | 'UPGRADED' | 'REFRESHED' | 'DISPUTE_RESOLVED' | 'ALREADY_VERIFIED';

interface ITarget {
  claim: ClaimType;
  role: RoleRow;
  person: PersonRow;
  contact?: ContactRow;
  value: string;
  key: string;
}

/**
 * Field-level verification (Phase 5). APPROVAL != VERIFICATION: nothing here changes
 * review_status, is_published, people.data_status or contact publication. Every decision is
 * evidence-backed, attributed, timestamped and audited in the same transaction. Ingestion never
 * writes to this ledger, so re-uploads cannot weaken a verified claim.
 */
@Injectable()
export class PeopleVerificationService {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: DrizzleDb,
    private readonly publishing: PeoplePublishingService,
  ) {}

  private assertNote(ctx: IReviewContext) {
    if (!ctx.note || ctx.note.trim().length < 3) throw bad('A note explaining the decision is required', 'REASON_REQUIRED');
  }

  private async resolveTarget(tx: Tx, roleId: string, claimRaw: string, contactId?: string): Promise<ITarget> {
    if (!(CLAIM_TYPES as readonly string[]).includes(claimRaw)) throw bad(`Unknown claim "${claimRaw}"`, 'INVALID_CLAIM');
    const claim = claimRaw as ClaimType;
    const [row] = await tx
      .select({ role: schema.companyPeople, person: schema.people })
      .from(schema.companyPeople)
      .innerJoin(schema.people, eq(schema.people.id, schema.companyPeople.personId))
      .where(eq(schema.companyPeople.id, roleId));
    if (!row) throw bad('Role not found', 'ROLE_NOT_FOUND', HttpStatus.NOT_FOUND);
    if (row.person.dataStatus === 'SUPPRESSED') throw bad('This person is suppressed', 'PERSON_SUPPRESSED', HttpStatus.CONFLICT);

    let contact: ContactRow | undefined;
    if (claim === 'EMAIL' || claim === 'PHONE') {
      if (!contactId) throw bad('contactId is required for this claim', 'CONTACT_REQUIRED');
      const [c] = await tx
        .select()
        .from(schema.personContacts)
        .where(and(eq(schema.personContacts.id, contactId), eq(schema.personContacts.personId, row.person.id)));
      if (!c) throw bad('Contact not found for this person', 'CONTACT_NOT_FOUND', HttpStatus.NOT_FOUND);
      const wanted = claim === 'EMAIL' ? c.contactType === 'WORK_EMAIL' : c.contactType !== 'WORK_EMAIL';
      if (!wanted) throw bad(`A ${c.contactType} contact cannot carry a ${claim} claim`, 'CONTACT_CLAIM_MISMATCH');
      contact = c;
    } else if (contactId) {
      throw bad('contactId only applies to EMAIL and PHONE claims', 'CONTACT_NOT_APPLICABLE');
    }

    const value = currentClaimValue(claim, { role: row.role, person: row.person, contact });
    if (!value) throw bad(`There is no ${claim} value on file to verify`, 'NOTHING_TO_VERIFY');
    return {
      claim,
      role: row.role,
      person: row.person,
      contact,
      value,
      key: targetKeyOf(claim, { personId: row.person.id, roleId: row.role.id, contactId: contact?.id }),
    };
  }

  private scopeOf(t: ITarget) {
    if (t.claim === 'IDENTITY' || t.claim === 'LINKEDIN') return { companyPersonId: null, contactId: null, scopeKey: `P:${t.person.id}` };
    if (t.claim === 'RELATIONSHIP' || t.claim === 'TITLE') return { companyPersonId: t.role.id, contactId: null, scopeKey: `R:${t.role.id}` };
    return { companyPersonId: null, contactId: t.contact!.id, scopeKey: `C:${t.contact!.id}` };
  }

  /** Existing evidence (must belong to this target) or new evidence recorded by the reviewer. */
  private async resolveEvidence(tx: Tx, t: ITarget, dto: VerifyClaimDto, now: Date) {
    const scope = this.scopeOf(t);
    if (!!dto.evidenceId === !!dto.evidence) {
      throw bad('Provide exactly one of evidenceId or evidence: a claim cannot be verified without evidence', 'EVIDENCE_REQUIRED');
    }

    let ev: typeof schema.peopleEvidence.$inferSelect | undefined;
    if (dto.evidenceId) {
      [ev] = await tx
        .select()
        .from(schema.peopleEvidence)
        .where(and(eq(schema.peopleEvidence.id, dto.evidenceId), eq(schema.peopleEvidence.personId, t.person.id)));
      if (!ev) throw bad('Evidence not found for this person', 'EVIDENCE_NOT_FOUND', HttpStatus.NOT_FOUND);
      const sameScope = (ev.companyPersonId ?? null) === scope.companyPersonId && (ev.contactId ?? null) === scope.contactId;
      if (!sameScope) throw bad('That evidence supports a different subject than this claim', 'EVIDENCE_TARGET_MISMATCH');
    } else {
      const e = dto.evidence!;
      const type = e.evidenceType;
      if (!e.sourceReference?.trim() && !e.sourceUrl?.trim()) throw bad('Evidence needs a source reference or URL', 'EVIDENCE_UNCITED');
      const observedAt = e.observedAt ? new Date(e.observedAt) : now;
      if (observedAt.getTime() > now.getTime() + 60_000) throw bad('Evidence cannot be observed in the future', 'EVIDENCE_DATE_INVALID');
      if (!isEvidenceAccepted(t.claim, type)) {
        throw bad(`${type} cannot verify a ${t.claim} claim (accepted: ${ACCEPTED_EVIDENCE[t.claim].join(', ')})`, 'EVIDENCE_TYPE_NOT_ACCEPTED');
      }
      const fingerprint = evidenceFingerprint([scope.scopeKey, e.sourceType, type, normalizeSourceLocator(e.sourceUrl, e.sourceReference)]);
      const [inserted] = await tx
        .insert(schema.peopleEvidence)
        .values({
          personId: t.person.id,
          companyPersonId: scope.companyPersonId,
          contactId: scope.contactId,
          fingerprint,
          sourceType: e.sourceType as any,
          evidenceType: type,
          sourceUrl: e.sourceUrl ?? null,
          sourceReference: e.sourceReference ?? null,
          observedAt,
        })
        .onConflictDoNothing()
        .returning();
      ev = inserted ?? (await tx.select().from(schema.peopleEvidence).where(eq(schema.peopleEvidence.fingerprint, fingerprint)))[0];
    }

    if (!isEvidenceAccepted(t.claim, ev.evidenceType)) {
      throw bad(`${ev.evidenceType} cannot verify a ${t.claim} claim (accepted: ${ACCEPTED_EVIDENCE[t.claim].join(', ')})`, 'EVIDENCE_TYPE_NOT_ACCEPTED');
    }
    if (!(ev.sourceReference ?? '').trim() && !(ev.sourceUrl ?? '').trim()) {
      throw bad('That evidence has no source reference or URL', 'EVIDENCE_UNCITED');
    }
    // Evidence only counts toward "verified" once verifiedAt is set (existing semantics).
    if (!ev.verifiedAt) {
      await tx.update(schema.peopleEvidence).set({ verifiedAt: now }).where(eq(schema.peopleEvidence.id, ev.id));
      ev = { ...ev, verifiedAt: now };
    }
    return ev;
  }

  private async ledgerRows(tx: Tx, key: string) {
    return tx.select().from(schema.peopleVerifications).where(eq(schema.peopleVerifications.targetKey, key));
  }

  // ------------------------------------------------------------------ verify
  async verify(roleId: string, dto: VerifyClaimDto, ctx: IReviewContext) {
    this.assertNote(ctx);
    return this.db.transaction(async (tx) => {
      const now = new Date();
      const t = await this.resolveTarget(tx, roleId, dto.claim, dto.contactId);
      // Serialise writers of this claim: the outcome is deterministic (one creates, the others see it).
      await lockTarget(tx, t.key);
      const ev = await this.resolveEvidence(tx, t, dto, now);
      const strength = evidenceStrength(ev.evidenceType);
      const claimed = claimedValueFor(t.claim, t.value);

      const rows = await this.ledgerRows(tx, t.key);
      const before = claimState(rows.map(toLedgerRow), claimed, now).state;
      let same = rows.find((r) => r.claimedValue === claimed);
      let outcome: VerifyOutcome | undefined;

      const decision = {
        status: 'VERIFIED',
        evidenceId: ev.id,
        evidenceStrength: strength,
        verifiedByKind: 'REVIEWER',
        method: 'REVIEWER_EVIDENCE',
        attestedBy: null,
        verifiedById: ctx.reviewerId ?? null,
        verifiedByLabel: ctx.reviewedBy,
        verifiedAt: now,
        note: ctx.note!.trim(),
        updatedAt: now,
      };
      if (!same) {
        const inserted = await tx
          .insert(schema.peopleVerifications)
          .values({
            claimType: t.claim,
            targetKey: t.key,
            personId: t.person.id,
            companyPersonId: t.claim === 'IDENTITY' || t.claim === 'LINKEDIN' || t.contact ? null : t.role.id,
            contactId: t.contact?.id ?? null,
            claimedValue: claimed,
            ...decision,
          })
          .onConflictDoNothing({ target: [schema.peopleVerifications.targetKey, schema.peopleVerifications.claimedValue] })
          .returning({ id: schema.peopleVerifications.id });
        if (inserted.length) outcome = 'VERIFIED';
        else same = (await this.ledgerRows(tx, t.key)).find((r) => r.claimedValue === claimed); // lost a race: use the winner
      }
      if (!outcome && same) {
        if (same.status === 'DISPUTED') {
          await tx.update(schema.peopleVerifications).set(decision).where(eq(schema.peopleVerifications.id, same.id));
          outcome = 'DISPUTE_RESOLVED';
        } else if (strength > same.evidenceStrength || (same.verifiedByKind === 'SYSTEM' && strength >= same.evidenceStrength)) {
          // stronger evidence, or a reviewer taking over a system attestation with evidence at least as strong
          await tx.update(schema.peopleVerifications).set(decision).where(eq(schema.peopleVerifications.id, same.id));
          outcome = 'UPGRADED';
        } else if (before === 'STALE') {
          // an old verification is renewed by fresh evidence (same strength is enough)
          await tx.update(schema.peopleVerifications).set(decision).where(eq(schema.peopleVerifications.id, same.id));
          outcome = 'REFRESHED';
        } else {
          // Already verified with evidence at least this strong: keep it (never replace stronger with weaker).
          return { outcome: 'ALREADY_VERIFIED' as VerifyOutcome, claim: t.claim, state: 'VERIFIED' as const, changed: false };
        }
      }

      await this.reconcile(tx, t, now);
      await this.publishing.writeAudit(tx, ctx, {
        action: 'PEOPLE_CLAIM_VERIFIED',
        entityType: this.entityType(t),
        entityId: this.entityId(t),
        old: { claim: t.claim, state: before, ...(same ? { evidenceId: same.evidenceId, evidenceStrength: same.evidenceStrength } : {}) },
        new: {
          claim: t.claim,
          ...this.auditValue(t),
          state: 'VERIFIED',
          outcome,
          verifiedByKind: 'REVIEWER',
          method: 'REVIEWER_EVIDENCE',
          evidenceId: ev.id,
          evidenceType: ev.evidenceType,
          evidenceReference: ev.sourceUrl || ev.sourceReference,
          personId: t.person.id,
          companyPersonId: t.role.id,
          companyId: t.role.businessId,
          ...(t.contact ? { contactId: t.contact.id } : {}),
        },
      });
      return { outcome: outcome!, claim: t.claim, state: 'VERIFIED' as const, changed: true, evidenceId: ev.id };
    });
  }

  // ------------------------------------------------------------------ dispute
  async dispute(roleId: string, dto: DisputeClaimDto, ctx: IReviewContext) {
    this.assertNote(ctx);
    return this.db.transaction(async (tx) => {
      const now = new Date();
      const t = await this.resolveTarget(tx, roleId, dto.claim, dto.contactId);
      await lockTarget(tx, t.key);
      const claimed = claimedValueFor(t.claim, t.value);
      const rows = await this.ledgerRows(tx, t.key);
      const same = rows.find((r) => r.claimedValue === claimed);
      const before = claimState(rows.map(toLedgerRow), claimed, now).state;
      if (same?.status === 'DISPUTED') return { outcome: 'ALREADY_DISPUTED', claim: t.claim, state: 'DISPUTED' as const, changed: false };

      const who = { verifiedByKind: 'REVIEWER', method: 'REVIEWER_EVIDENCE', attestedBy: null, verifiedById: ctx.reviewerId ?? null, verifiedByLabel: ctx.reviewedBy, verifiedAt: now, note: ctx.note!.trim() };
      if (!same) {
        await tx
          .insert(schema.peopleVerifications)
          .values({
            claimType: t.claim,
            targetKey: t.key,
            personId: t.person.id,
            companyPersonId: t.claim === 'IDENTITY' || t.claim === 'LINKEDIN' || t.contact ? null : t.role.id,
            contactId: t.contact?.id ?? null,
            claimedValue: claimed,
            status: 'DISPUTED',
            ...who,
          })
          .onConflictDoNothing({ target: [schema.peopleVerifications.targetKey, schema.peopleVerifications.claimedValue] });
      }
      // create-or-update converge on the same result, even if a concurrent writer created the row first;
      // the evidence that once supported the claim stays linked as history
      await tx
        .update(schema.peopleVerifications)
        .set({ status: 'DISPUTED', ...who, updatedAt: now })
        .where(and(eq(schema.peopleVerifications.targetKey, t.key), eq(schema.peopleVerifications.claimedValue, claimed)));

      await this.reconcile(tx, t, now);
      await this.publishing.writeAudit(tx, ctx, {
        action: 'PEOPLE_CLAIM_DISPUTED',
        entityType: this.entityType(t),
        entityId: this.entityId(t),
        old: { claim: t.claim, state: before },
        new: {
          claim: t.claim,
          ...this.auditValue(t),
          state: 'DISPUTED',
          personId: t.person.id,
          companyPersonId: t.role.id,
          companyId: t.role.businessId,
          ...(t.contact ? { contactId: t.contact.id } : {}),
        },
      });
      return { outcome: 'DISPUTED', claim: t.claim, state: 'DISPUTED' as const, changed: true };
    });
  }

  private entityType(t: ITarget) {
    return t.contact ? ('PEOPLE_CONTACT' as const) : t.claim === 'IDENTITY' || t.claim === 'LINKEDIN' ? ('PEOPLE_PERSON' as const) : ('PEOPLE_ROLE' as const);
  }
  private entityId(t: ITarget) {
    return t.contact ? t.contact.id : t.claim === 'IDENTITY' || t.claim === 'LINKEDIN' ? t.person.id : t.role.id;
  }
  /** Contact data (email / phone / LinkedIn) never goes into audit rows either: the ids identify it. */
  private auditValue(t: ITarget) {
    return SENSITIVE_CLAIMS.includes(t.claim) ? {} : { value: t.value };
  }

  /** Derived columns follow the ledger (see verification-state.ts). Publication columns are never touched. */
  private async reconcile(tx: Tx, t: ITarget, now: Date) {
    if (t.contact) await reconcileContact(tx, t.contact.id, now);
    else if (t.claim === 'TITLE' || t.claim === 'RELATIONSHIP') await reconcileRole(tx, t.role.id, now);
  }

  /**
   * Called by the reviewer edit flow after a name/title change: claims whose verified value no longer
   * matches now need review, so a role is never shown as verified for a value nobody verified.
   */
  async afterReviewerEdit(tx: Tx, roleId: string, ctx: IReviewContext, now: Date) {
    const [row] = await tx
      .select({ role: schema.companyPeople, person: schema.people })
      .from(schema.companyPeople)
      .innerJoin(schema.people, eq(schema.people.id, schema.companyPeople.personId))
      .where(eq(schema.companyPeople.id, roleId));
    if (!row) return [] as string[];
    const rows = await tx
      .select()
      .from(schema.peopleVerifications)
      .where(inArray(schema.peopleVerifications.targetKey, [`TITLE:${roleId}`, `IDENTITY:${row.person.id}`]));
    const invalidated: string[] = [];
    for (const claim of ['TITLE', 'IDENTITY'] as const) {
      const value = currentClaimValue(claim, row);
      const mine = rows.filter((r) => r.claimType === claim).map(toLedgerRow);
      if (value && mine.length && claimState(mine, claimedValueFor(claim, value), now).state === 'NEEDS_REVIEW') invalidated.push(claim);
    }
    // always reconcile: the title may have changed even when no verified claim was affected
    await reconcileRole(tx, roleId, now);
    if (invalidated.length) {
      await this.publishing.writeAudit(tx, ctx, {
        action: 'PEOPLE_CLAIM_NEEDS_REVIEW',
        entityType: 'PEOPLE_ROLE',
        entityId: roleId,
        new: { claims: invalidated, personId: row.person.id, companyId: row.role.businessId, why: 'value changed after it was verified' },
      });
    }
    return invalidated;
  }

  // ------------------------------------------------------------------ read
  async getPanel(roleId: string) {
    const [row] = await this.db
      .select({ role: schema.companyPeople, person: schema.people, companyName: schema.businesses.name })
      .from(schema.companyPeople)
      .innerJoin(schema.people, eq(schema.people.id, schema.companyPeople.personId))
      .innerJoin(schema.businesses, eq(schema.businesses.id, schema.companyPeople.businessId))
      .where(eq(schema.companyPeople.id, roleId));
    if (!row) throw bad('Role not found', 'ROLE_NOT_FOUND', HttpStatus.NOT_FOUND);
    const [contacts, evidence, ledger] = await Promise.all([
      this.db.select().from(schema.personContacts).where(eq(schema.personContacts.personId, row.person.id)),
      this.db.select().from(schema.peopleEvidence).where(eq(schema.peopleEvidence.personId, row.person.id)),
      this.db.select().from(schema.peopleVerifications).where(eq(schema.peopleVerifications.personId, row.person.id)),
    ]);
    return buildVerificationPanel({ ...row, contacts, evidence, ledger: ledger.map(toLedgerRow) });
  }
}
