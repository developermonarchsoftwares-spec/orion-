import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { and, eq, sql } from 'drizzle-orm';
import { DRIZZLE_DATABASE } from '../../database/database.constants';
import { DrizzleDb } from '../../database/database.provider';
import * as schema from '../../database/schema';
import { BusinessException } from '../../common/errors/business.exception';
import { expireStoredExports } from '../../common/privacy/stored-exports';
import { SuppressionOrigin, lockPerson, lockPersonOfContact, lockPersonOfRole, registerSuppressedIdentities } from './suppression/people-suppression';
import { withRequestId } from '../../common/services/audit-values';

type Tx = Parameters<Parameters<DrizzleDb['transaction']>[0]>[0];

export type ReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'QUARANTINED';

/** Who is acting and why. `reviewerId` is the users.id (recorded on the role and in the audit log). */
export interface IReviewContext {
  /** Display label of the actor (email/name); always audited. */
  reviewedBy: string;
  reviewerId?: string;
  /** Required for reject / quarantine / suppress / unpublish. */
  note?: string;
}

const asContext = (c: string | IReviewContext): IReviewContext => (typeof c === 'string' ? { reviewedBy: c } : c);

/**
 * THE publishing gate for the People layer (internal; no HTTP surface here - the reviewer API
 * calls this). All visibility changes go through this service and every change is audited in
 * the same transaction:  DRAFT -> PENDING review -> APPROVED (published) | REJECTED | QUARANTINED.
 *
 * Publishing is role-level: publishing one role never publishes another role of the same person,
 * and contacts are published individually.
 */
@Injectable()
export class PeoplePublishingService {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: DrizzleDb) {}

  /** Runs `fn` and its audit record atomically. */
  async audited<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(fn);
  }

  async writeAudit(
    tx: Tx,
    ctx: IReviewContext,
    entry: {
      action: string;
      entityType: 'PEOPLE_ROLE' | 'PEOPLE_PERSON' | 'PEOPLE_CONTACT' | 'PEOPLE_QUARANTINE';
      entityId: string;
      old?: Record<string, unknown>;
      new?: Record<string, unknown>;
    },
  ) {
    await tx.insert(schema.auditLogs).values({
      userId: ctx.reviewerId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      oldValues: entry.old ?? null,
      newValues: withRequestId({ ...(entry.new ?? {}), reviewedBy: ctx.reviewedBy, ...(ctx.note ? { reason: ctx.note } : {}) }),
    });
  }

  private requireReason(ctx: IReviewContext, what: string) {
    if (!ctx.note || ctx.note.trim().length < 3) {
      throw new BusinessException(`A reason is required to ${what}`, 'REASON_REQUIRED', HttpStatus.BAD_REQUEST);
    }
  }

  /**
   * Every review action loads its role through here, so the person lock is taken BEFORE the role and person are read: the state checked
   * (suppressed? rejected? published?) is the state written, and a concurrent suppression / review action on the same person waits.
   */
  private async loadRole(tx: Tx, companyPersonId: string) {
    await lockPersonOfRole(tx, companyPersonId);
    const [row] = await tx
      .select({ role: schema.companyPeople, person: schema.people })
      .from(schema.companyPeople)
      .innerJoin(schema.people, eq(schema.people.id, schema.companyPeople.personId))
      .where(eq(schema.companyPeople.id, companyPersonId));
    if (!row) throw new BusinessException('Role not found', 'ROLE_NOT_FOUND', HttpStatus.NOT_FOUND);
    return row;
  }

  /**
   * Closes the PENDING reviewer-quarantine items of these roles (the queue row written by quarantineRole), so the queue never keeps an
   * open item for a role that has left QUARANTINED some other way (reopened, rejected, person suppressed).
   */
  private async closeReviewerQuarantine(tx: Tx, roleIds: string[], status: 'RESOLVED' | 'DISCARDED', ctx: IReviewContext, action: string) {
    if (roleIds.length === 0) return;
    await tx
      .update(schema.peopleIngestionQuarantine)
      .set({ status, resolution: { action, by: ctx.reviewedBy, at: new Date().toISOString(), note: ctx.note ?? null }, updatedAt: new Date() })
      .where(
        and(
          sql`${schema.peopleIngestionQuarantine.raw}->>'companyPersonId' IN (${sql.join(roleIds.map((id) => sql`${id}`), sql`, `)})`,
          eq(schema.peopleIngestionQuarantine.status, 'PENDING'),
        ),
      );
  }

  private roleState(role: typeof schema.companyPeople.$inferSelect) {
    return { reviewStatus: role.reviewStatus, isPublished: role.isPublished };
  }

  private reviewFields(ctx: IReviewContext, status: ReviewStatus, published: boolean) {
    return {
      reviewStatus: status,
      isPublished: published,
      reviewedAt: new Date(),
      reviewedById: ctx.reviewerId ?? null,
      reviewNote: ctx.note ?? null,
      updatedAt: new Date(),
    };
  }

  /**
   * Makes ONE person-at-company role (and the person record) customer-visible. Needs a valid
   * relationship, an unsuppressed person, at least one evidence row on that role, and a role that is
   * not rejected/quarantined (reopen it first). Other roles and all contacts are untouched.
   */
  async publishRole(companyPersonId: string, context: string | IReviewContext) {
    return this.db.transaction((tx) => this.publishRoleTx(tx, companyPersonId, asContext(context)));
  }

  /** Same rules as publishRole, inside the caller's transaction (used for atomic edit-and-approve). */
  async publishRoleTx(tx: Tx, companyPersonId: string, ctx: IReviewContext) {
    {
      const { role, person } = await this.loadRole(tx, companyPersonId);
      if (person.dataStatus === 'SUPPRESSED') {
        throw new BusinessException('Person is suppressed', 'PERSON_SUPPRESSED', HttpStatus.CONFLICT);
      }
      if (role.reviewStatus === 'REJECTED' || role.reviewStatus === 'QUARANTINED') {
        throw new BusinessException(`A ${role.reviewStatus.toLowerCase()} role must be reopened before it can be published`, 'REVIEW_STATE_INVALID', HttpStatus.CONFLICT);
      }
      const [{ n }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.peopleEvidence)
        .where(eq(schema.peopleEvidence.companyPersonId, companyPersonId));
      if (n === 0) {
        throw new BusinessException('A role cannot be published without evidence', 'EVIDENCE_REQUIRED', HttpStatus.CONFLICT);
      }
      const before = this.roleState(role);
      // a reviewer approving the role is the confirmation event; it is not verification
      await tx.update(schema.companyPeople).set({ ...this.reviewFields(ctx, 'APPROVED', true), lastConfirmedAt: new Date() }).where(eq(schema.companyPeople.id, companyPersonId));
      await tx.update(schema.people).set({ dataStatus: 'PUBLISHED', updatedAt: new Date() }).where(eq(schema.people.id, person.id));
      await this.writeAudit(tx, ctx, {
        action: 'PEOPLE_ROLE_PUBLISHED',
        entityType: 'PEOPLE_ROLE',
        entityId: companyPersonId,
        old: { ...before, personStatus: person.dataStatus },
        new: { reviewStatus: 'APPROVED', isPublished: true, personId: person.id, companyId: role.businessId },
      });
      return { companyPersonId, personId: person.id, isPublished: true };
    }
  }

  /** Takes a PUBLISHED (approved) role offline. It returns to PENDING so it must be reviewed again before republishing. Any other state is a 409. */
  async unpublishRole(companyPersonId: string, context: string | IReviewContext) {
    const ctx = asContext(context);
    return this.db.transaction(async (tx) => {
      const { role } = await this.loadRole(tx, companyPersonId);
      // Unpublish is the way down from APPROVED + published and nothing else. A REJECTED or QUARANTINED role goes back to PENDING only
      // through reopenRole (which also closes its reviewer-quarantine item); a PENDING role has nothing to unpublish.
      if (role.reviewStatus !== 'APPROVED' || !role.isPublished) {
        throw new BusinessException(
          role.reviewStatus === 'REJECTED' || role.reviewStatus === 'QUARANTINED'
            ? `A ${role.reviewStatus.toLowerCase()} role is reopened, not unpublished`
            : 'Only a published role can be unpublished',
          'REVIEW_STATE_INVALID',
          HttpStatus.CONFLICT,
        );
      }
      await tx.update(schema.companyPeople).set(this.reviewFields(ctx, 'PENDING', false)).where(eq(schema.companyPeople.id, companyPersonId));
      await this.writeAudit(tx, ctx, {
        action: 'PEOPLE_ROLE_UNPUBLISHED',
        entityType: 'PEOPLE_ROLE',
        entityId: companyPersonId,
        old: this.roleState(role),
        new: { reviewStatus: 'PENDING', isPublished: false, personId: role.personId, companyId: role.businessId },
      });
      return { companyPersonId, isPublished: false };
    });
  }

  /** Keeps the role hidden and out of the pending queue. Requires a reason. */
  async rejectRole(companyPersonId: string, context: IReviewContext) {
    this.requireReason(context, 'reject a role');
    return this.db.transaction(async (tx) => {
      const { role } = await this.loadRole(tx, companyPersonId);
      await tx.update(schema.companyPeople).set(this.reviewFields(context, 'REJECTED', false)).where(eq(schema.companyPeople.id, companyPersonId));
      // QUARANTINED -> REJECTED is the reviewer discarding a held role: its reviewer-quarantine item is closed in the same transaction
      if (role.reviewStatus === 'QUARANTINED') await this.closeReviewerQuarantine(tx, [companyPersonId], 'DISCARDED', context, 'REJECTED');
      await this.writeAudit(tx, context, {
        action: 'PEOPLE_ROLE_REJECTED',
        entityType: 'PEOPLE_ROLE',
        entityId: companyPersonId,
        old: this.roleState(role),
        new: { reviewStatus: 'REJECTED', isPublished: false, personId: role.personId, companyId: role.businessId },
      });
      return { companyPersonId, reviewStatus: 'REJECTED' as const };
    });
  }

  /**
   * Holds the role for data fixes: hidden, and a snapshot is added to the existing quarantine
   * queue (people_ingestion_quarantine) so it shows up in the same reviewer workflow.
   */
  async quarantineRole(companyPersonId: string, context: IReviewContext) {
    this.requireReason(context, 'quarantine a role');
    return this.db.transaction(async (tx) => {
      const { role, person } = await this.loadRole(tx, companyPersonId);
      // REJECTED -> QUARANTINED would be a second hidden state reached without a review: reopen the role first (same rule as publishing it)
      if (role.reviewStatus === 'REJECTED') {
        throw new BusinessException('A rejected role must be reopened before it can be quarantined', 'REVIEW_STATE_INVALID', HttpStatus.CONFLICT);
      }
      await tx.update(schema.companyPeople).set(this.reviewFields(context, 'QUARANTINED', false)).where(eq(schema.companyPeople.id, companyPersonId));
      const raw = {
        kind: 'REVIEWER_QUARANTINE',
        companyPersonId,
        personId: person.id,
        businessId: role.businessId,
        personName: person.fullName,
        jobTitle: role.jobTitleAtCompany,
      };
      const fingerprint = createHash('sha256').update(`review-quarantine|${companyPersonId}`).digest('hex');
      const reasons = [{ code: 'REVIEWER_QUARANTINE', message: context.note! }];
      await tx
        .insert(schema.peopleIngestionQuarantine)
        .values({ batchRef: 'review', sourceLabel: 'reviewer', fingerprint, raw, reasons })
        .onConflictDoUpdate({
          target: schema.peopleIngestionQuarantine.fingerprint,
          set: { reasons, status: 'PENDING', resolution: null, updatedAt: new Date() },
        });
      await this.writeAudit(tx, context, {
        action: 'PEOPLE_ROLE_QUARANTINED',
        entityType: 'PEOPLE_ROLE',
        entityId: companyPersonId,
        old: this.roleState(role),
        new: { reviewStatus: 'QUARANTINED', isPublished: false, personId: person.id, companyId: role.businessId },
      });
      return { companyPersonId, reviewStatus: 'QUARANTINED' as const };
    });
  }

  /** Sends a rejected/quarantined role back to the pending queue (closing its reviewer-quarantine item). */
  async reopenRole(companyPersonId: string, context: string | IReviewContext) {
    const ctx = asContext(context);
    return this.db.transaction(async (tx) => {
      const { role, person } = await this.loadRole(tx, companyPersonId);
      // suppression is terminal (publishing, editing and contact publishing already refuse it): a suppressed person's roles stay closed
      if (person.dataStatus === 'SUPPRESSED') throw new BusinessException('Person is suppressed', 'PERSON_SUPPRESSED', HttpStatus.CONFLICT);
      if (role.reviewStatus === 'PENDING' || role.reviewStatus === 'APPROVED') {
        throw new BusinessException('Only rejected or quarantined roles can be reopened', 'REVIEW_STATE_INVALID', HttpStatus.CONFLICT);
      }
      await tx.update(schema.companyPeople).set(this.reviewFields(ctx, 'PENDING', false)).where(eq(schema.companyPeople.id, companyPersonId));
      await this.closeReviewerQuarantine(tx, [companyPersonId], 'RESOLVED', ctx, 'REOPENED');
      await this.writeAudit(tx, ctx, {
        action: 'PEOPLE_ROLE_REOPENED',
        entityType: 'PEOPLE_ROLE',
        entityId: companyPersonId,
        old: this.roleState(role),
        new: { reviewStatus: 'PENDING', isPublished: false, personId: role.personId, companyId: role.businessId },
      });
      return { companyPersonId, reviewStatus: 'PENDING' as const };
    });
  }

  /** Allows a contact point to be revealed to customers who unlock the person. Needs contact-level evidence. */
  async publishContact(contactId: string, context: string | IReviewContext) {
    return this.db.transaction((tx) => this.publishContactTx(tx, contactId, asContext(context)));
  }

  async publishContactTx(tx: Tx, contactId: string, ctx: IReviewContext) {
    {
      await lockPersonOfContact(tx, contactId); // before reading the person: a suppression that committed first is seen, one that has not waits
      const [row] = await tx
        .select({ contact: schema.personContacts, person: schema.people })
        .from(schema.personContacts)
        .innerJoin(schema.people, eq(schema.people.id, schema.personContacts.personId))
        .where(eq(schema.personContacts.id, contactId));
      if (!row) throw new BusinessException('Contact not found', 'CONTACT_NOT_FOUND', HttpStatus.NOT_FOUND);
      if (row.person.dataStatus === 'SUPPRESSED') {
        throw new BusinessException('Person is suppressed', 'PERSON_SUPPRESSED', HttpStatus.CONFLICT);
      }
      if (row.contact.verificationStatus === 'CONFLICTED') {
        throw new BusinessException('A conflicted contact cannot be published', 'CONTACT_CONFLICTED', HttpStatus.CONFLICT);
      }
      const [{ n }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.peopleEvidence)
        .where(eq(schema.peopleEvidence.contactId, contactId));
      if (n === 0) {
        throw new BusinessException('A contact cannot be published without evidence', 'EVIDENCE_REQUIRED', HttpStatus.CONFLICT);
      }
      const acceptedAt = new Date();
      // a reviewer accepting (publishing) the contact is the confirmation event; it is not verification
      await tx.update(schema.personContacts).set({ isPublished: true, lastConfirmedAt: acceptedAt, updatedAt: acceptedAt }).where(eq(schema.personContacts.id, contactId));
      await this.writeAudit(tx, ctx, {
        action: 'PEOPLE_CONTACT_PUBLISHED',
        entityType: 'PEOPLE_CONTACT',
        entityId: contactId,
        old: { isPublished: row.contact.isPublished },
        new: { isPublished: true, contactType: row.contact.contactType, personId: row.person.id },
      });
      return { contactId, isPublished: true };
    }
  }

  async unpublishContact(contactId: string, context: string | IReviewContext) {
    const ctx = asContext(context);
    return this.db.transaction(async (tx) => {
      await lockPersonOfContact(tx, contactId);
      const [row] = await tx.select().from(schema.personContacts).where(eq(schema.personContacts.id, contactId));
      if (!row) throw new BusinessException('Contact not found', 'CONTACT_NOT_FOUND', HttpStatus.NOT_FOUND);
      await tx.update(schema.personContacts).set({ isPublished: false, updatedAt: new Date() }).where(eq(schema.personContacts.id, contactId));
      await this.writeAudit(tx, ctx, {
        action: 'PEOPLE_CONTACT_UNPUBLISHED',
        entityType: 'PEOPLE_CONTACT',
        entityId: contactId,
        old: { isPublished: row.isPublished },
        new: { isPublished: false, contactType: row.contactType, personId: row.personId },
      });
      return { contactId, isPublished: false };
    });
  }

  /**
   * Opt-out / takedown: hides the person everywhere, closes every role as REJECTED, and blocks
   * re-ingestion (ingestion refuses SUPPRESSED identities). Requires a reason when called by a reviewer.
   */
  async suppressPerson(
    personId: string,
    context: string | IReviewContext,
    opts: { origin?: SuppressionOrigin; sourceReference?: string } = {},
  ) {
    const ctx = asContext(context);
    return this.db.transaction(async (tx) => {
      // serialised with ingestion of the same person: nothing can slip a new role in between the status change and the registry entry
      await lockPerson(tx, personId);
      const [person] = await tx.select().from(schema.people).where(eq(schema.people.id, personId));
      if (!person) throw new BusinessException('Person not found', 'PERSON_NOT_FOUND', HttpStatus.NOT_FOUND);
      const roles = await tx.select().from(schema.companyPeople).where(eq(schema.companyPeople.personId, personId));
      await tx.update(schema.people).set({ dataStatus: 'SUPPRESSED', updatedAt: new Date() }).where(eq(schema.people.id, personId));
      await tx
        .update(schema.companyPeople)
        .set(this.reviewFields(ctx, 'REJECTED', false))
        .where(eq(schema.companyPeople.personId, personId));
      await tx
        .update(schema.personContacts)
        .set({ isPublished: false, updatedAt: new Date() })
        .where(eq(schema.personContacts.personId, personId));
      // Durable anti-resurrection entries, in the SAME transaction: the person is never suppressed without being registered.
      // a suppressed person has no role left to reopen: close the open reviewer-quarantine items of its roles
      await this.closeReviewerQuarantine(tx, roles.map((r) => r.id), 'DISCARDED', ctx, 'PERSON_SUPPRESSED');
      // a stored scheduled-export file may hold this person's contact values: expire it (history stays)
      await expireStoredExports(tx);
      const registry = await registerSuppressedIdentities(tx, personId, {
        reason: ctx.note,
        origin: opts.origin ?? 'REVIEWER_ACTION',
        sourceReference: opts.sourceReference,
        byKind: 'REVIEWER',
        byId: ctx.reviewerId ?? null,
        byLabel: ctx.reviewedBy,
      });
      await this.writeAudit(tx, ctx, {
        action: 'PEOPLE_PERSON_SUPPRESSED',
        entityType: 'PEOPLE_PERSON',
        entityId: personId,
        old: { dataStatus: person.dataStatus, roles: roles.map((r) => ({ id: r.id, ...this.roleState(r) })) },
        new: { dataStatus: 'SUPPRESSED', companyIds: [...new Set(roles.map((r) => r.businessId))], identitiesRegistered: registry.registered, identitiesAlreadyRegistered: registry.already },
      });
      return { personId, dataStatus: 'SUPPRESSED' as const };
    });
  }
}
